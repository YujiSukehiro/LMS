import { randomUUID } from 'node:crypto';
import { adminDb } from '@/lib/firebase/admin';
import { jsonError, requireAuth } from '@/lib/firebase/auth-guard';
import { getLLMGateway } from '@/lib/ai/gateway';
import { buildActorMessages, buildActorSystemPrompt } from '@/lib/ai/prompts/sim-actor';
import { SimSessionDocSchema, type SimMessage } from '@/lib/schemas/analytics';
import type { PublicSimScenario } from '@/lib/schemas/curriculum';
import { SimMessageRequestSchema, type SimDoneEvent } from '@/lib/schemas/api';
import { ServiceError, isServiceError } from '@/lib/services/errors';
import { appendDialogueEvent, assessmentEligibility, assertSafeSyntheticText, evaluateDeterministicGates } from '@/lib/services/scenario-state';
import { errorResponse, parseJsonBody } from '@/lib/services/route-helpers';
import { createSimEndStreamFilter } from '@/lib/services/sim-end-filter';
import {
  createSimulationProvenance,
  loadOwnedSimSession,
  simSessionsCollection,
} from '@/lib/services/simulation-engine';
import { loadSecretScenario, loadTrack, loadVersion } from '@/lib/services/track-loader';
import { sseFrame } from '@/lib/utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Actor replies stream on the fast tier; allow time for a cold local model. */
export const maxDuration = 120;

const ACTOR_MAX_OUTPUT_TOKENS = 320;
const ACTOR_TEMPERATURE = 0.6;

/**
 * POST /api/simulations/[sessionId]/message
 * Adds the agent's message and streams the counterparty Actor reply as SSE:
 * `event: token` {token} ... then `event: done` {simEnded, turnCount}, or `event: error` {message}.
 * The agent message and the reply are saved together in one write after the reply is complete.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
): Promise<Response> {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { user } = auth;
  const { sessionId } = await params;

  const body = await parseJsonBody(req, SimMessageRequestSchema);
  if (!body.ok) return body.response;
  const content = body.data.content.trim();
  if (!content) return jsonError(400, 'VALIDATION_FAILED', 'Type a message before you send it.');

  // ---- Validate everything before the stream starts so errors return normal JSON responses ----
  let prepared: {
    systemPrompt: string;
    history: SimMessage[];
    agentMessage: SimMessage;
    scenario: PublicSimScenario;
    expectedTurnCount: number;
    nextTurnCount: number;
    maxTurns: number;
  };
  try {
    assertSafeSyntheticText(content, 'the call transcript');
    const session = await loadOwnedSimSession(user, sessionId);
    if (session.status !== 'ACTIVE' || session.scenarioState?.lifecycle !== 'in_call') {
      return jsonError(409, 'SIM_NOT_IN_CALL', 'Complete pre-call inspection and dial before sending dialogue.');
    }

    const [track, version, secret] = await Promise.all([
      loadTrack(session.trackId),
      loadVersion(session.trackId, session.versionId),
      loadSecretScenario(session.trackId, session.versionId, session.scenarioId),
    ]);
    const scenario = version?.simScenarios.find((s) => s.id === session.scenarioId);
    if (!track || !version || !scenario) {
      return jsonError(404, 'SCENARIO_NOT_FOUND', 'The Simulation for this session no longer exists.');
    }
    if (!secret) return jsonError(409, 'SIM_NOT_READY', 'This Simulation is not configured. Contact a Trainer.');

    if (session.turnCount >= scenario.maxTurns) {
      return jsonError(409, 'SIM_TURN_LIMIT', 'You reached the turn limit. Select a disposition to get your score.');
    }

    const now = Date.now();
    const agentMessage: SimMessage = { id: randomUUID(), role: 'agent', content, createdAt: now };
    const nextTurnCount = session.turnCount + 1;
    prepared = {
      systemPrompt: buildActorSystemPrompt({
        scenario,
        secret,
        divisionId: track.divisionId,
        campaignCode: track.campaignCode,
        turnCount: nextTurnCount,
      }),
      history: [...session.messages, agentMessage],
      agentMessage,
      scenario,
      expectedTurnCount: session.turnCount,
      nextTurnCount,
      maxTurns: scenario.maxTurns,
    };
  } catch (error) {
    return errorResponse(error, 'simulations/message');
  }

  // ---- Stream the Actor reply ----
  const llmAbort = new AbortController();
  const onClientAbort = () => llmAbort.abort();
  if (req.signal.aborted) llmAbort.abort();
  else req.signal.addEventListener('abort', onClientAbort, { once: true });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed || llmAbort.signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(sseFrame(event, data)));
        } catch {
          closed = true;
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // The stream is already closed by the client.
        }
      };

      try {
        const filter = createSimEndStreamFilter();
        let replyText = '';
        const tokens = getLLMGateway().streamChat({
          tier: 'fast',
          messages: buildActorMessages(prepared.history, prepared.systemPrompt),
          temperature: ACTOR_TEMPERATURE,
          maxOutputTokens: ACTOR_MAX_OUTPUT_TOKENS,
          signal: llmAbort.signal,
        });
        for await (const chunk of tokens) {
          if (llmAbort.signal.aborted) break;
          const safe = filter.push(chunk);
          if (safe) {
            replyText += safe;
            send('token', { token: safe });
          }
        }
        if (llmAbort.signal.aborted) return; // Client left: do not save a partial reply.

        const tail = filter.flush();
        if (tail) {
          replyText += tail;
          send('token', { token: tail });
        }

        const reply = replyText.trim();
        const sentinelSeen = filter.simEnded;
        if (!reply && !sentinelSeen) {
          throw new ServiceError(502, 'ACTOR_EMPTY_REPLY', 'The caller did not answer. Send your message again.');
        }

        const simEnded = sentinelSeen || prepared.nextTurnCount >= prepared.maxTurns;
        const replyMessage: SimMessage | null = reply
          ? {
              id: randomUUID(),
              role: 'counterparty',
              content: reply,
              createdAt: Date.now(),
              provenance: createSimulationProvenance({
                task: 'actor',
                systemPrompt: prepared.systemPrompt,
                messages: prepared.history,
              }),
            }
          : null;

        // Dialogue, state, gate evidence, and append-only events commit atomically.
        const ref = simSessionsCollection().doc(sessionId);
        await adminDb.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          if (!snap.exists) throw new ServiceError(404, 'SESSION_NOT_FOUND', 'This Simulation session does not exist.');
          const current = SimSessionDocSchema.parse({ ...snap.data(), id: snap.id });
          if (current.status !== 'ACTIVE' || current.turnCount !== prepared.expectedTurnCount || current.scenarioState?.lifecycle !== 'in_call' || !current.simulationEvents) {
            throw new ServiceError(409, 'SIM_CONFLICT', 'This call changed in another window. Reload the page to continue.');
          }
          const learner = appendDialogueEvent({
            sessionId,
            state: current.scenarioState,
            events: current.simulationEvents,
            actor: 'learner',
            content: prepared.agentMessage.content,
            provenance: 'learner',
            now: new Date(prepared.agentMessage.createdAt),
            eventId: prepared.agentMessage.id,
          });
          let state = learner.state;
          let events = [...current.simulationEvents, learner.event];
          if (replyMessage) {
            const source = replyMessage.provenance?.source;
            const customer = appendDialogueEvent({
              sessionId,
              state,
              events,
              actor: 'customer',
              content: replyMessage.content,
              provenance: source === 'replay' ? 'replay' : source === 'manual_chat' ? 'manual_chat' : 'local_ai',
              runtimeProvenance: replyMessage.provenance,
              now: new Date(replyMessage.createdAt),
              eventId: replyMessage.id,
            });
            state = customer.state;
            events = [...events, customer.event];
          }
          const gates = evaluateDeterministicGates(prepared.scenario, state, events);
          const messages = replyMessage
            ? [...current.messages, prepared.agentMessage, replyMessage]
            : [...current.messages, prepared.agentMessage];
          tx.update(ref, {
            messages,
            turnCount: prepared.nextTurnCount,
            status: 'ACTIVE',
            scenarioState: state,
            simulationEvents: events,
            gateResults: gates,
            assessmentEligibility: assessmentEligibility(prepared.scenario, state, events, gates),
            nextEventSequence: events[events.length - 1]!.sequence + 1,
            updatedAt: Date.now(),
          });
          for (const event of events.slice(current.simulationEvents.length)) {
            tx.set(ref.collection('events').doc(event.id), event);
          }
        });

        const done: SimDoneEvent = { simEnded, turnCount: prepared.nextTurnCount };
        send('done', done);
      } catch (error) {
        if (!llmAbort.signal.aborted) {
          const message = isServiceError(error)
            ? error.message
            : 'The caller could not answer because of a server error. Send your message again.';
          if (!isServiceError(error)) console.error('[simulations/message] Actor stream failed', error);
          send('error', { message });
        }
      } finally {
        req.signal.removeEventListener('abort', onClientAbort);
        close();
      }
    },
    cancel() {
      llmAbort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
