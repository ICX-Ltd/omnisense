<template>
  <div class="lch">
    <button type="button" class="lch-btn" @click="open = !open">
      {{ open ? "Hide explanation" : "What's this?" }}
    </button>
    <div v-if="open" class="lch-panel">
      <p>These are words the transcription AI (Deepgram) scored as <strong>low confidence</strong> — under 60% sure it heard them correctly.</p>
      <p><strong>Low confidence doesn't mean the word is wrong.</strong> On phone calls — background noise, crosstalk, people talking over each other, fast or mumbled speech, a poor line — even everyday words like &ldquo;the&rdquo;, &ldquo;was&rdquo; or &ldquo;that&rdquo; often score low, and they're usually still correct. It reflects audio clarity, not accuracy.</p>
      <p><strong>What's worth a look</strong> is any unusual word — especially a vehicle <strong>make/model</strong> or a <strong>name</strong> — because those are the ones most likely mis-heard (e.g. &ldquo;Duke&rdquo; for &ldquo;Juke&rdquo;). Recurring shaky makes/models are the ones worth teaching the transcriber via the vehicle vocabulary list.</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
const open = ref(false);
</script>

<style scoped>
.lch {
  display: inline-block;
}
.lch-btn {
  border: 1px solid color-mix(in srgb, #6366f1 40%, transparent);
  background: transparent;
  color: var(--brand, #6366f1);
  font-size: 11px;
  font-weight: 700;
  padding: 2px 9px;
  border-radius: 999px;
  cursor: pointer;
}
.lch-btn:hover {
  background: color-mix(in srgb, #6366f1 10%, transparent);
}
.lch-panel {
  margin-top: 8px;
  padding: 10px 12px;
  background: var(--surface, #fff);
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.55;
  color: var(--ink, #1e293b);
  max-width: 560px;
}
.lch-panel p {
  margin: 0 0 8px;
}
.lch-panel p:last-child {
  margin-bottom: 0;
}
</style>
