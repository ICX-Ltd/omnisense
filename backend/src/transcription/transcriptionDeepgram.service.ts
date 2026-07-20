import { Injectable } from '@nestjs/common';
import { VEHICLE_KEYTERMS, VEHICLE_REPLACEMENTS } from './vehicle-vocab';
import { describeError } from '../utils/describe-error.util';

type DiarizedTurn = {
  speaker: number;
  start: number;
  end: number;
  text: string;
};

function smoothTurns(turns: DiarizedTurn[]) {
  const out: DiarizedTurn[] = [];

  for (const t of turns) {
    const text = (t.text || '').trim();
    const dur = (t.end ?? 0) - (t.start ?? 0);
    const wc = text ? text.split(/\s+/).length : 0;

    const prev = out[out.length - 1];

    // Merge adjacent same-speaker
    if (prev && prev.speaker === t.speaker) {
      prev.end = Math.max(prev.end, t.end);
      prev.text = `${prev.text} ${text}`.trim();
      continue;
    }

    // Merge “tiny” turns into previous (even if speaker differs)
    const tiny = (dur > 0 && dur < 0.8) || (wc > 0 && wc <= 3);
    if (tiny && prev) {
      prev.end = Math.max(prev.end, t.end);
      prev.text = `${prev.text} ${text}`.trim();
      continue;
    }

    out.push({ ...t, text });
  }

  return out;
}

@Injectable()
export class TranscriptionDeepgramService {
  private readonly apiKey = process.env.DEEPGRAM_API_KEY;

  // Builds the model + query string shared by both the URL and buffer paths.
  private buildEndpoint() {
    // Model is env-tunable so we can A/B nova-3 (keyterm prompting) against the
    // phone-tuned nova-2-phonecall on real calls without redeploying.
    const model = process.env.DEEPGRAM_MODEL || 'nova-2-phonecall';

    const params = new URLSearchParams({
      model,
      // UK English nudges British vocabulary/pronunciation; env-overridable in
      // case a model variant rejects the regional locale.
      language: process.env.DEEPGRAM_LANGUAGE || 'en-GB',
      diarize: 'true',
      utterances: 'true',
      smart_format: 'true',
      punctuate: 'true',
    });

    // Bias recognition toward our vehicle vocabulary. nova-3 supports the newer,
    // stronger keyterm prompting; nova-2 only supports keyword boosting.
    if (model.startsWith('nova-3')) {
      for (const term of VEHICLE_KEYTERMS) params.append('keyterm', term);
    } else {
      // :2 intensifier nudges weighting up without over-biasing.
      for (const term of VEHICLE_KEYTERMS)
        params.append('keywords', `${term}:2`);
    }

    // Deterministic safety net for stubborn, well-known mishears (blind swap).
    for (const [from, to] of VEHICLE_REPLACEMENTS) {
      params.append('replace', `${from}:${to}`);
    }

    //const endpoint = `https://api.deepgram.com/v1/listen?${params.toString()}`;
    return `https://api.eu.deepgram.com/v1/listen?${params.toString()}`;
  }

  /**
   * Transcribe pre-downloaded audio bytes. Preferred over transcribeUrl for
   * media hosted on servers Deepgram's fetcher can't consume — e.g. the
   * MaxContact ASP.NET `downLoad` endpoint, which 405s on HEAD and ignores
   * Range, triggering Deepgram REMOTE_CONTENT_ERROR. We fetch server-side
   * (a plain GET works there) and post the raw buffer instead.
   */
  async transcribeBuffer(buffer: Buffer, contentType = 'audio/wav') {
    if (!this.apiKey) throw new Error('Missing DEEPGRAM_API_KEY');
    return this.postToDeepgram(buffer, contentType);
  }

  async transcribeUrl(url: string) {
    if (!this.apiKey) throw new Error('Missing DEEPGRAM_API_KEY');
    return this.postToDeepgram(JSON.stringify({ url }), 'application/json');
  }

  private async postToDeepgram(
    body: Buffer | string,
    contentType: string,
  ) {
    const endpoint = this.buildEndpoint();
    const host = new URL(endpoint).host;

    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Token ${this.apiKey}`,
          'Content-Type': contentType,
        },
        body: body as any,
      });
    } catch (e) {
      // Network-level failure (DNS/TCP/TLS/timeout) before any HTTP response —
      // fetch throws a bare "fetch failed"; surface the underlying cause.
      throw new Error(
        `Deepgram request failed (network) to ${host}: ${describeError(e)}`,
      );
    }

    const textOrJson = await res.text();
    if (!res.ok) {
      throw new Error(`Deepgram error ${res.status}: ${textOrJson}`);
    }

    // We already read text, so parse once here.
    const json = JSON.parse(textOrJson);

    // console.log('debug deepgam result', json);
    // console.log(
    //   'debug deepgram utterances',
    //   JSON.stringify(json?.results?.utterances, null, 2),
    // );
    // const turns: DiarizedTurn[] =
    //   json?.results?.utterances?.map((u: any) => ({
    //     speaker: u.speaker,
    //     start: u.start,
    //     end: u.end,
    //     text: u.transcript,
    //   })) ?? [];

    const utterances = json?.results?.utterances ?? [];

    const turnsRaw: DiarizedTurn[] = utterances.map((u: any) => ({
      speaker: u.speaker,
      start: u.start,
      end: u.end,
      text: u.transcript,
    }));

    const turns = turnsRaw;

    //console.log(Object.keys(json.results));
    //console.log(Object.keys(json.results.channels[0].alternatives[0]));
    //console.log('utterances length', utterances.length);
    //console.dir(utterances.slice(0, 2), { depth: null });

    const alt = json?.results?.channels?.[0]?.alternatives?.[0] ?? {};
    const fullText = alt.transcript ?? '';

    // Overall alternative confidence (0–1) + the words the model was least sure
    // about. Low-confidence proper nouns (makes/models mis-heard) are the signal
    // for spot-checking a call and for growing the vehicle keyterm/replace lists.
    const overallConfidence =
      typeof alt.confidence === 'number' ? alt.confidence : null;
    const lowConfidenceWords = summariseLowConfidence(alt.words ?? []);

    return {
      provider: 'deepgram',
      text: fullText,
      turns,
      confidence: overallConfidence,
      lowConfidenceWords,
      // Audio length (seconds) for per-minute cost tracking. Deepgram returns it
      // in metadata.duration.
      durationSeconds:
        typeof json?.metadata?.duration === 'number'
          ? json.metadata.duration
          : null,
      // raw: json, // keep for testing; remove for production
    };
  }
}

// Deepgram per-word confidence → deduped list of the shakiest words, worst
// first. Punctuation/short filler is skipped; each entry keeps its lowest seen
// confidence and how many times it appeared low. Capped so the blob stays small.
const LOW_CONFIDENCE_THRESHOLD = 0.6;
const LOW_CONFIDENCE_MAX = 25;

function summariseLowConfidence(
  words: Array<{ word?: string; punctuated_word?: string; confidence?: number }>,
): Array<{ word: string; confidence: number; count: number }> {
  const agg = new Map<string, { word: string; confidence: number; count: number }>();
  for (const w of words) {
    const conf = typeof w.confidence === 'number' ? w.confidence : 1;
    if (conf >= LOW_CONFIDENCE_THRESHOLD) continue;
    const raw = (w.punctuated_word || w.word || '').trim();
    const clean = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    if (clean.length < 3) continue; // skip filler / stray punctuation
    const key = clean.toLowerCase();
    const existing = agg.get(key);
    if (existing) {
      existing.count += 1;
      existing.confidence = Math.min(existing.confidence, conf);
    } else {
      agg.set(key, { word: clean, confidence: conf, count: 1 });
    }
  }
  return [...agg.values()]
    .sort((a, b) => a.confidence - b.confidence)
    .slice(0, LOW_CONFIDENCE_MAX);
}
