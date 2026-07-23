<template>
  <div>
    <div>
      <!-- Hero -->
      <div class="hero">
        <div class="hero-row">
          <div class="hero-left">
            <h1 class="hero-title">Test Lab</h1>
            <div class="hero-subtitle">
              Upload audio to transcribe, or paste transcript text directly.
              Then generate insights.
            </div>
          </div>

          <div class="hero-right">
            <span class="chip chip--primary">Testing</span>
            <span class="chip chip--secondary">
              Ready:
              <strong style="margin-left: 6px">{{
                canGenerate ? "Yes" : "No"
              }}</strong>
            </span>
          </div>
        </div>
      </div>

      <div class="grid grid-2">
        <!-- Audio tile -->
        <div class="tile tile--accent" @click="() => {}">
          <div class="tile-head">
            <IconChip name="audio" />
            <div class="tile-text">
              <div class="tile-title">Audio Transcription</div>
              <div class="tile-desc">
                Upload a call recording and transcribe
              </div>
            </div>
            <div class="spacer"></div>
          </div>

          <div class="tile-body" @click.stop>
            <div class="muted">
              Supported formats depend on the source; WAV/MP3/M4A usually work.
            </div>

            <div class="actions-row" style="margin-top: 10px">
              <label class="label">Transcription Provider</label>
              <select v-model="provider" class="select">
                <option :value="TranscriptionProvider.OpenAI">
                  OpenAI (upload file)
                </option>
                <option :value="TranscriptionProvider.Deepgram">
                  Deepgram (fetch by URL)
                </option>
              </select>
            </div>

            <div
              v-if="provider === 'deepgram'"
              class="actions-row"
              style="margin-top: 10px"
            >
              <input
                v-model="recordingUrl"
                class="input"
                placeholder="https://.../recording.wav"
              />
            </div>

            <div
              class="actions-row"
              style="margin-top: 10px"
              v-if="provider === 'openai'"
            >
              <input type="file" accept="audio/*" @change="onPick" />
            </div>

            <div v-if="file" class="hint" style="margin-top: 10px">
              File: <strong>{{ file.name }}</strong> ({{
                prettyBytes(file.size)
              }})
            </div>

            <div class="actions-row" style="margin-top: 10px">
              <button
                class="btn btn--primary"
                :disabled="!canTranscribe || loadingTranscribe"
                @click="transcribe"
              >
                {{ loadingTranscribe ? "Transcribing..." : "Transcribe" }}
              </button>

              <button
                class="btn btn--ghost"
                :disabled="loadingTranscribe"
                @click="clearFile"
              >
                Clear File
              </button>
            </div>

            <div
              v-if="errorTranscribe"
              class="error-tile"
              style="margin-top: 10px"
            >
              <div class="error-title">Transcription error</div>
              <div class="error-text">{{ errorTranscribe }}</div>
            </div>
          </div>
        </div>

        <!-- Insights tile -->
        <div class="tile" @click="() => {}">
          <div class="tile-head">
            <IconChip name="insights" />
            <div class="tile-text">
              <div class="tile-title">Insights</div>
              <div class="tile-desc">
                Generate structured call insights from transcript
              </div>
            </div>
            <div class="spacer"></div>
          </div>

          <div class="tile-body" @click.stop>
            <div class="muted">
              You can edit the transcript before generating insights (handy for
              quick testing).
            </div>

            <div class="actions-row" style="margin-top: 10px">
              <label class="label">Insights Provider</label>
              <select v-model="insightsProvider" class="select">
                <option :value="InsightsProvider.OpenAI">OpenAI</option>
                <option :value="InsightsProvider.Anthropic">Anthropic</option>
                <option :value="InsightsProvider.Grok">Grok</option>
                <option :value="InsightsProvider.Gemini">Gemini</option>
              </select>
            </div>

            <div class="actions-row" style="margin-top: 10px">
              <button
                class="btn btn--primary"
                :disabled="!canGenerate || loadingInsights"
                @click="generateInsights"
              >
                {{ loadingInsights ? "Generating..." : "Generate Insights" }}
              </button>

              <button
                class="btn btn--ghost"
                :disabled="loadingInsights"
                @click="clearTranscript"
              >
                Clear Transcript
              </button>

              <span class="chip" v-if="transcriptText.trim().length">
                chars:
                <strong style="margin-left: 6px">{{
                  transcriptText.trim().length
                }}</strong>
              </span>
            </div>

            <div
              v-if="errorInsights"
              class="error-tile"
              style="margin-top: 10px"
            >
              <div class="error-title">Insights error</div>
              <div class="error-text">{{ errorInsights }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Transcript editor + output -->
      <div class="split">
        <!-- Transcript -->
        <div class="panel">
          <div class="row-top" style="margin-bottom: 10px">
            <div class="tile-title">Transcript (editable)</div>
            <span class="chip chip--secondary">{{
              canGenerate ? "ready" : "needs more text"
            }}</span>
          </div>

          <textarea
            v-model="transcriptText"
            class="textarea"
            placeholder="Paste transcript here, or transcribe an audio file above..."
          />

          <div class="hint" style="margin-top: 8px">
            Tip: if you’re just testing the insight extractor, paste any example
            transcript here.
          </div>
        </div>

        <!-- Insights output -->
        <div class="panel">
          <div class="row-top" style="margin-bottom: 10px">
            <div class="tile-title">Insights Output</div>
            <span class="chip chip--primary" v-if="insightsPretty"
              >generated</span
            >
            <span class="chip" v-else>empty</span>
          </div>

          <div v-if="insightsPretty" class="prompt-box">
            <pre class="pre">{{ insightsPretty }}</pre>
          </div>

          <div v-else class="hint">Generate insights to see results here.</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import IconChip from "./IconChip.vue";
import axios from "axios";
import { computed, ref } from "vue";
import { ApiPath, InsightsProvider, TranscriptionProvider } from "@/enums/api";
import { toPrettyInsights } from "@/utils/insights-response";

const file = ref<File | null>(null);

const loadingTranscribe = ref(false);
const loadingInsights = ref(false);

const transcriptText = ref("");
const insightsPretty = ref("");

const errorTranscribe = ref("");
const errorInsights = ref("");

const provider = ref<TranscriptionProvider>(TranscriptionProvider.OpenAI);
const insightsProvider = ref<InsightsProvider>(InsightsProvider.OpenAI);
const recordingUrl = ref("");

const canTranscribe = computed(() => {
  if (provider.value === TranscriptionProvider.OpenAI) return !!file.value;
  return recordingUrl.value.trim().length > 10;
});

const canGenerate = computed(() => transcriptText.value.trim().length >= 20);

function onPick(e: Event) {
  const input = e.target as HTMLInputElement;
  file.value = input.files?.[0] ?? null;
  errorTranscribe.value = "";
}

function clearFile() {
  file.value = null;
}

function clearTranscript() {
  transcriptText.value = "";
  insightsPretty.value = "";
  errorInsights.value = "";
}

function prettyBytes(n: number) {
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let x = n;
  while (x >= 1024 && i < units.length - 1) {
    x /= 1024;
    i++;
  }
  return `${x.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

async function transcribe() {
  loadingTranscribe.value = true;
  errorTranscribe.value = "";

  try {
    if (provider.value === TranscriptionProvider.OpenAI) {
      if (!file.value) return;

      const form = new FormData();
      form.append("file", file.value);

      const res = await axios.post(ApiPath.TranscriptionCall, form, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      transcriptText.value =
        res.data?.text ?? JSON.stringify(res.data, null, 2);
      return;
    }

    const url = recordingUrl.value.trim();
    if (!url) return;

    const res = await axios.post(ApiPath.TranscriptionCallUrl, { url });

    if (Array.isArray(res.data?.turns) && res.data.turns.length) {
      transcriptText.value = res.data.turns
        .map((t: any) => `Speaker ${t.speaker}: ${t.text}`)
        .join("\n");
    } else {
      transcriptText.value =
        res.data?.text ?? JSON.stringify(res.data, null, 2);
    }
  } catch (e: any) {
    const msg =
      e?.response?.data?.message ||
      e?.response?.data?.error ||
      e?.message ||
      "Unknown error";
    errorTranscribe.value = typeof msg === "string" ? msg : JSON.stringify(msg);
  } finally {
    loadingTranscribe.value = false;
  }
}

async function generateInsights() {
  if (!canGenerate.value) return;

  loadingInsights.value = true;
  errorInsights.value = "";
  insightsPretty.value = "";

  try {
    const res = await axios.post(ApiPath.InsightsCall, {
      transcript: transcriptText.value,
      provider: insightsProvider.value,
    });

    insightsPretty.value = toPrettyInsights(res.data);
  } catch (e: any) {
    const msg =
      e?.response?.data?.message ||
      e?.response?.data?.error ||
      e?.message ||
      "Unknown error";
    errorInsights.value = typeof msg === "string" ? msg : JSON.stringify(msg);
  } finally {
    loadingInsights.value = false;
  }
}
</script>
