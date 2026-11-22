import { describe, expect, it } from 'vitest';
import { parseRosterCsv, rosterTemplateCsv } from '@/app/(dashboard)/roster/_components/roster-csv';

const defaults = { cohortDefaultDivisions: { THS: ['TELEHEALTH', 'INBOUND'] as const, DOZ: ['INBOUND'] as const } };

describe('roster bulk-import CSV', () => {
  it('parses its own downloadable template cleanly, defaulting the blank role and Divisions', () => {
    const lines = parseRosterCsv(rosterTemplateCsv('THS'), defaults);
    expect(lines.map((line) => line.error)).toEqual([null, null]);
    expect(lines[0].row).toMatchObject({ lcNumber: 'LC-1101', role: 'AGENT', divisionIds: ['TELEHEALTH', 'INBOUND'] });
    expect(lines[1].row).toMatchObject({ email: 'jordan.blake@example.com', role: 'AGENT', divisionIds: ['TELEHEALTH', 'INBOUND'] });
  });

  it('matches columns by header name in any order and tolerates an Excel BOM and missing optional columns', () => {
    const csv = '﻿Email,Display Name,Partner Cohort ID\r\nana@example.com,Ana Ruiz,doz\r\n';
    const [line] = parseRosterCsv(csv, defaults);
    expect(line.error).toBeNull();
    expect(line.row).toMatchObject({ displayName: 'Ana Ruiz', email: 'ana@example.com', partnerCohortId: 'DOZ', role: 'AGENT', divisionIds: ['INBOUND'] });
  });

  it('keeps an explicit role and accepts friendly spacing', () => {
    const [line] = parseRosterCsv('displayName,lcNumber,email,role,partnerCohortId,divisionIds\nLucia,LC-2001,,partner supervisor,THS,TELEHEALTH', defaults);
    expect(line.row?.role).toBe('PARTNER_SUPERVISOR');
  });

  it('still parses headerless positional rows, and explains a blank Division for an unknown Cohort', () => {
    const [ok, unknown] = parseRosterCsv('Maria,LC-1101,,,THS,\nBo,LC-1102,,,NOPE,', defaults);
    expect(ok.row).toMatchObject({ role: 'AGENT', divisionIds: ['TELEHEALTH', 'INBOUND'] });
    expect(unknown.error).toMatch(/default Divisions/);
  });

  it('rejects a row with neither LC Number nor email', () => {
    const [line] = parseRosterCsv('displayName,partnerCohortId\nNo Login,THS', defaults);
    expect(line.row).toBeNull();
    expect(line.error).toMatch(/LC Number or an email/);
  });
});
