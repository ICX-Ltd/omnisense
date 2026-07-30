import { normaliseTranscript, classifySpeaker } from './transcript-normalise';
import { parseChatTranscript } from '../../insights/chat-response-time';
import { LIVEPERSON_MAPPING } from '../mappings/source-mappings';

const mapping = LIVEPERSON_MAPPING.transcript;
const anchor = new Date(2026, 5, 1); // 2026-06-01

function run(raw: string, opts: Partial<Parameters<typeof normaliseTranscript>[0]> = {}) {
  return normaliseTranscript({
    raw,
    anchorDate: anchor,
    mapping,
    agentNames: [],
    ...opts,
  });
}

describe('classifySpeaker', () => {
  it.each([
    ['Agent', 'Agent'],
    ['agent', 'Agent'],
    ['Consumer', 'Customer'],
    ['visitor', 'Customer'],
    ['System', 'System'],
    ['Bot', 'Bot'],
  ])('classifies %s as %s', (label, expected) => {
    expect(classifySpeaker(label, mapping, [])).toBe(expected);
  });

  it('classifies a real agent name as Agent', () => {
    // LivePerson exports often print the colleague's name, not the role.
    expect(classifySpeaker('Jane Smith', mapping, ['Jane Smith'])).toBe('Agent');
  });

  it('matches agent names case-insensitively', () => {
    expect(classifySpeaker('jane smith', mapping, ['Jane Smith'])).toBe('Agent');
  });

  it('never guesses — an unrecognised label is Unknown', () => {
    expect(classifySpeaker('Supervisor Bob', mapping, ['Jane Smith'])).toBe(
      'Unknown',
    );
  });

  it('treats a blank label as Unknown', () => {
    expect(classifySpeaker('   ', mapping, [])).toBe('Unknown');
  });
});

describe('normaliseTranscript', () => {
  it('parses a straightforward conversation', () => {
    const r = run(
      [
        '09:15:02 - Consumer: hi, my car has broken down',
        '09:15:30 - Agent: sorry to hear that, where are you?',
        '09:16:10 - Consumer: junction 14 of the M1',
      ].join('\n'),
    );

    expect(r.status).toBe('parsed');
    expect(r.messages).toHaveLength(3);
    expect(r.includedCount).toBe(3);
    expect(r.messages.map((m) => m.source)).toEqual([
      'Customer',
      'Agent',
      'Customer',
    ]);
    expect(r.messages[0]!.timestampIso).toBe('2026-06-01T09:15:02');
    expect(r.messages[2]!.timestampIso).toBe('2026-06-01T09:16:10');
  });

  it('accepts HH:MM without seconds', () => {
    const r = run('09:15 - Agent: hello');
    expect(r.messages[0]!.timestampIso).toBe('2026-06-01T09:15:00');
  });

  it('accepts en-dash and em-dash separators', () => {
    const r = run('09:15 – Agent: hello\n09:16 — Consumer: hi');
    expect(r.messages).toHaveLength(2);
  });

  it('folds continuation lines into the previous message, keeping newlines', () => {
    const r = run(
      [
        '09:15:02 - Consumer: my postcode is',
        'NW1 4RY',
        'and I am on the hard shoulder',
        '09:15:30 - Agent: thanks',
      ].join('\n'),
    );

    expect(r.messages).toHaveLength(2);
    expect(r.messages[0]!.content).toBe(
      'my postcode is\nNW1 4RY\nand I am on the hard shoulder',
    );
  });

  describe('midnight rollover', () => {
    it('increments the day when the clock jumps backwards', () => {
      const r = run(
        [
          '23:58:00 - Consumer: still waiting',
          '23:59:30 - Agent: nearly there',
          '00:01:15 - Consumer: ok thanks',
          '00:02:00 - Agent: no problem',
        ].join('\n'),
      );

      expect(r.messages.map((m) => m.dayOffset)).toEqual([0, 0, 1, 1]);
      expect(r.messages[2]!.timestampIso).toBe('2026-06-02T00:01:15');
      expect(r.messages[3]!.timestampIso).toBe('2026-06-02T00:02:00');
      expect(r.maxDayOffset).toBe(1);
    });

    it('does not invent a day jump for out-of-order lines in the same minute', () => {
      // Several messages sharing a timestamp is common and must not roll over.
      const r = run(
        [
          '09:15:30 - Consumer: one',
          '09:15:02 - Agent: two',
          '09:15:45 - Consumer: three',
        ].join('\n'),
      );
      expect(r.messages.map((m) => m.dayOffset)).toEqual([0, 0, 0]);
    });

    it('handles a chat spanning multiple days', () => {
      const r = run(
        [
          '22:00:00 - Consumer: day one',
          '01:00:00 - Agent: day two',
          '02:00:00 - Consumer: still day two',
          '01:30:00 - Agent: day three',
        ].join('\n'),
      );
      expect(r.messages.map((m) => m.dayOffset)).toEqual([0, 1, 1, 2]);
      expect(r.messages[3]!.timestampIso).toBe('2026-06-03T01:30:00');
    });

    it('caps the day offset so a corrupt transcript cannot run away', () => {
      // Alternating high/low clocks would otherwise increment indefinitely.
      const lines: string[] = [];
      for (let i = 0; i < 20; i++) {
        lines.push('23:00:00 - Consumer: late');
        lines.push('01:00:00 - Agent: early');
      }
      const r = run(lines.join('\n'));
      expect(r.maxDayOffset).toBeLessThanOrEqual(7);
    });
  });

  describe('unknown speakers', () => {
    it('stages them but excludes them from the promoted transcript', () => {
      const r = run(
        [
          '09:15:02 - Consumer: hello',
          '09:15:10 - Supervisor Bob: stepping in',
          '09:15:30 - Agent: hi there',
        ].join('\n'),
      );

      expect(r.messages).toHaveLength(3);
      expect(r.unknownSpeakerCount).toBe(1);
      expect(r.status).toBe('partial');

      const unknown = r.messages[1]!;
      expect(unknown.source).toBe('Unknown');
      expect(unknown.includedInTranscript).toBe(false);
      expect(unknown.parseWarning).toMatch(/Supervisor Bob/);

      // Only the two recognised messages reach the transcript.
      expect(r.includedCount).toBe(2);
      const payload = JSON.parse(r.transcriptJson!);
      expect(payload).toHaveLength(2);
      expect(payload.map((m: { content: string }) => m.content)).toEqual([
        'hello',
        'hi there',
      ]);
    });

    it('resolves an agent-name label rather than dropping it', () => {
      const r = run('09:15:10 - Jane Smith: hi there', {
        agentNames: ['Jane Smith'],
      });
      expect(r.messages[0]!.source).toBe('Agent');
      expect(r.unknownSpeakerCount).toBe(0);
      expect(r.status).toBe('parsed');
    });
  });

  it('labels System and Bot messages as agent-side so they are not dropped', () => {
    const r = run(
      [
        '09:15:00 - System: chat started',
        '09:15:05 - Bot: how can I help?',
        '09:15:20 - Consumer: breakdown',
      ].join('\n'),
    );

    expect(r.messages.map((m) => m.source)).toEqual(['System', 'Bot', 'Customer']);
    const payload = JSON.parse(r.transcriptJson!);
    expect(payload.map((m: { source: string }) => m.source)).toEqual([
      'Agent',
      'Agent',
      'Customer',
    ]);
  });

  it('flags the bot/human handover boundary', () => {
    const r = run(
      [
        '09:15:05 - Bot: welcome',
        '09:15:20 - Agent: You are now connected to Jane',
        '09:15:30 - Agent: hello',
      ].join('\n'),
    );
    expect(r.messages.map((m) => m.isHandover)).toEqual([false, true, false]);
  });

  it('flags templated auto-messages', () => {
    const r = run(
      [
        '09:15:05 - Agent: Are you still there?',
        '09:15:30 - Agent: What is your postcode?',
      ].join('\n'),
    );
    expect(r.messages.map((m) => m.isAuto)).toEqual([true, false]);
  });

  describe('side-column fallback', () => {
    it('merges agent and consumer columns by clock when the combined column is empty', () => {
      const r = run('', {
        agentSide: '09:15:30 - Agent: sorry to hear that\n09:16:40 - Agent: on its way',
        consumerSide: '09:15:02 - Consumer: broken down\n09:16:10 - Consumer: junction 14',
      });

      expect(r.messages).toHaveLength(4);
      expect(r.messages.map((m) => m.source)).toEqual([
        'Customer',
        'Agent',
        'Customer',
        'Agent',
      ]);
      expect(r.messages.map((m) => m.seq)).toEqual([0, 1, 2, 3]);
      expect(r.status).toBe('parsed');
    });

    it('trusts the column over the label when merging sides', () => {
      // Side columns make the speaker unambiguous even with an odd label.
      const r = run('', { agentSide: '09:15:30 - Whoever: text' });
      expect(r.messages[0]!.source).toBe('Agent');
    });
  });

  describe('degenerate input', () => {
    it('reports empty for a blank transcript', () => {
      expect(run('').status).toBe('empty');
      expect(run('   \n  ').status).toBe('empty');
      expect(
        normaliseTranscript({ raw: null, anchorDate: anchor, mapping }).status,
      ).toBe('empty');
    });

    it('reports unparsed when no line matches, and counts the lines', () => {
      const r = run('this is just prose\nwith no timestamps at all');
      expect(r.status).toBe('unparsed');
      expect(r.transcriptJson).toBeNull();
      expect(r.unparsedLineCount).toBe(2);
    });

    it('rejects an impossible clock rather than trusting it', () => {
      const r = run('99:99 - Agent: nonsense');
      expect(r.status).toBe('unparsed');
    });

    it('leaves timestampIso null when there is no anchor date', () => {
      const r = normaliseTranscript({
        raw: '09:15:02 - Agent: hello',
        anchorDate: null,
        mapping,
      });
      expect(r.messages[0]!.timestampIso).toBeNull();
      // Falls back to the printed clock so the message is still usable.
      expect(JSON.parse(r.transcriptJson!)[0].timestamp).toBe('09:15:02');
    });

    it('does not treat a colon inside prose as a speaker delimiter', () => {
      const r = run(
        [
          '09:15:02 - Agent: here is the link',
          'Note: please click it within 24 hours',
        ].join('\n'),
      );
      expect(r.messages).toHaveLength(1);
      expect(r.messages[0]!.content).toContain('Note: please click it');
    });
  });

  // The point of emitting JSON at all: the existing consumer must accept it.
  describe('contract with the existing chat pipeline', () => {
    it('produces JSON that parseChatTranscript reads back correctly', () => {
      const r = run(
        [
          '09:15:02 - Consumer: hello',
          '09:15:30 - Agent: hi, how can I help?',
          '09:16:10 - Consumer: breakdown on the M1',
        ].join('\n'),
      );

      const reparsed = parseChatTranscript(r.transcriptJson!);
      expect(reparsed).toHaveLength(3);
      expect(reparsed.map((m) => m.source)).toEqual([
        'consumer',
        'agent',
        'consumer',
      ]);
      expect(reparsed[0]!.content).toBe('hello');
    });

    it('yields non-negative, correct gaps across midnight', () => {
      // This is what the plain-text line format gets wrong: seconds-from-midnight
      // arithmetic would make this gap -86,235s instead of +105s.
      const r = run(
        ['23:59:30 - Consumer: are you there?', '00:01:15 - Agent: yes, sorry'].join(
          '\n',
        ),
      );

      const reparsed = parseChatTranscript(r.transcriptJson!);
      expect(reparsed).toHaveLength(2);
      const gap = reparsed[1]!.totalSeconds - reparsed[0]!.totalSeconds;
      expect(gap).toBe(105);
    });

    it('emits the id and sender fields the detail drawer needs for bubbles', () => {
      const r = run('09:15:30 - Jane Smith: hello', { agentNames: ['Jane Smith'] });
      const payload = JSON.parse(r.transcriptJson!);
      expect(payload[0]).toEqual({
        id: 0,
        source: 'Agent',
        sender: 'Jane Smith',
        timestamp: '2026-06-01T09:15:30',
        content: 'hello',
      });
    });

    it('renumbers ids contiguously after unknown speakers are excluded', () => {
      // A gap in `id` would break the drawer's list keys.
      const r = run(
        [
          '09:15:00 - Consumer: one',
          '09:15:10 - Mystery Person: two',
          '09:15:20 - Agent: three',
        ].join('\n'),
      );
      const payload = JSON.parse(r.transcriptJson!);
      expect(payload.map((m: { id: number }) => m.id)).toEqual([0, 1]);
    });
  });
});
