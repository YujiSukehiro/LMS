import { RADAR_PILLAR_KEYS } from '@/lib/schemas/constants';
import { pillarShortLabel } from '@/components/layout/labels';

export interface RadarValue {
  key: string;
  /** 0..100, or null when the agent has no attempts in this CompetencyPillar. */
  value: number | null;
}

const SIZE = 360;
const CENTER = SIZE / 2;
const RADIUS = 118;
const RINGS = [25, 50, 75, 100];

function point(axisIndex: number, axisCount: number, pct: number): [number, number] {
  const angle = -Math.PI / 2 + (axisIndex * 2 * Math.PI) / axisCount;
  const r = (Math.max(0, Math.min(100, pct)) / 100) * RADIUS;
  return [CENTER + r * Math.cos(angle), CENTER + r * Math.sin(angle)];
}

function polygon(values: number[]): string {
  return values
    .map((v, i) => point(i, values.length, v))
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ');
}

/** Pure inline-SVG 6-axis Skill Radar over RADAR_PILLAR_KEYS. Missing values plot as 0 with a muted label. */
export function SkillRadarSvg({ values, agentName }: { values: RadarValue[]; agentName: string }) {
  const byKey = new Map(values.map((v) => [v.key, v.value]));
  const axes = RADAR_PILLAR_KEYS.map((key) => ({
    key,
    label: pillarShortLabel(key),
    value: byKey.get(key) ?? null,
  }));
  const plotted = axes.map((a) => a.value ?? 0);
  const titleId = 'skill-radar-title';
  const descId = 'skill-radar-desc';
  const description = axes
    .map((a) => `${a.label}: ${a.value === null ? 'no data' : `${Math.round(a.value)}%`}`)
    .join('; ');

  return (
    <svg
      viewBox={`-90 -10 ${SIZE + 180} ${SIZE + 20}`}
      role="img"
      aria-labelledby={`${titleId} ${descId}`}
      className="h-auto w-full max-w-[460px]"
    >
      <title id={titleId}>{`Skill Radar for ${agentName}`}</title>
      <desc id={descId}>{description}</desc>

      {RINGS.map((ring) => (
        <polygon
          key={ring}
          points={polygon(axes.map(() => ring))}
          fill={ring === 100 ? 'color-mix(in srgb, var(--pulse-surface-2) 55%, transparent)' : 'none'}
          stroke="var(--pulse-border)"
          strokeWidth={ring === 100 ? 1.2 : 0.8}
          strokeDasharray={ring === 100 ? undefined : '3 3'}
        />
      ))}
      {RINGS.map((ring) => {
        const [, y] = point(0, axes.length, ring);
        return (
          <text
            key={`label-${ring}`}
            x={CENTER + 4}
            y={y + 3}
            fontSize={9}
            fill="var(--pulse-text-muted)"
            fontFamily="var(--pulse-font-mono)"
          >
            {ring}
          </text>
        );
      })}

      {axes.map((axis, i) => {
        const [x, y] = point(i, axes.length, 100);
        return <line key={axis.key} x1={CENTER} y1={CENTER} x2={x} y2={y} stroke="var(--pulse-border)" strokeWidth={0.8} />;
      })}

      <polygon
        points={polygon(plotted)}
        fill="color-mix(in srgb, var(--pulse-indigo) 30%, transparent)"
        stroke="var(--pulse-indigo)"
        strokeWidth={2}
        strokeLinejoin="round"
      />
      {plotted.map((v, i) => {
        const [x, y] = point(i, axes.length, v);
        return (
          <circle
            key={axes[i].key}
            cx={x}
            cy={y}
            r={3.5}
            fill={axes[i].value === null ? 'var(--pulse-text-muted)' : 'var(--pulse-indigo)'}
            stroke="var(--pulse-surface-1)"
            strokeWidth={1.5}
          />
        );
      })}

      {axes.map((axis, i) => {
        const [x, y] = point(i, axes.length, 100);
        const angle = -Math.PI / 2 + (i * 2 * Math.PI) / axes.length;
        const dx = Math.cos(angle);
        const dy = Math.sin(angle);
        const lx = x + dx * 18;
        const ly = y + dy * 18;
        const anchor = Math.abs(dx) < 0.2 ? 'middle' : dx > 0 ? 'start' : 'end';
        const missing = axis.value === null;
        return (
          <g key={`axis-label-${axis.key}`}>
            <text
              x={lx}
              y={ly + (dy > 0.5 ? 6 : dy < -0.5 ? -8 : 0)}
              textAnchor={anchor}
              fontSize={11}
              fontWeight={600}
              fill={missing ? 'var(--pulse-text-muted)' : 'var(--pulse-text-secondary)'}
              opacity={missing ? 0.7 : 1}
            >
              {axis.label}
            </text>
            <text
              x={lx}
              y={ly + (dy > 0.5 ? 20 : dy < -0.5 ? 6 : 14)}
              textAnchor={anchor}
              fontSize={11}
              fontFamily="var(--pulse-font-mono)"
              fill={missing ? 'var(--pulse-text-muted)' : 'var(--pulse-text-primary)'}
              opacity={missing ? 0.7 : 1}
            >
              {missing ? 'no data' : `${Math.round(axis.value ?? 0)}%`}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
