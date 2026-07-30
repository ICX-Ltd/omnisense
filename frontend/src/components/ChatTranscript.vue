<template>
  <div class="ct-root">
    <!-- Optional toggle. The drawer renders its own in the section title, so it
         passes :show-toggle="false" and drives `view` with v-model. -->
    <div v-if="showToggle && hasBubbles" class="chat-view-toggle ct-toggle">
      <button
        type="button"
        class="chat-view-btn"
        :class="{ 'chat-view-btn--active': activeView === 'bubbles' }"
        @click="setView('bubbles')"
      >
        {{ isChat ? "Chat" : "Conversation" }}
      </button>
      <button
        type="button"
        class="chat-view-btn"
        :class="{ 'chat-view-btn--active': activeView === 'raw' }"
        @click="setView('raw')"
      >
        Raw
      </button>
    </div>

    <!-- chat bubbles -->
    <div
      v-if="isChat && chatMessages.length && activeView === 'bubbles'"
      class="chat-thread"
    >
      <div
        v-for="msg in chatMessages"
        :key="msg.id"
        class="chat-msg"
        :class="msg.source === 'Agent' ? 'chat-msg--agent' : 'chat-msg--customer'"
      >
        <div
          class="chat-bubble"
          :class="
            msg.source === 'Agent' ? 'chat-bubble--agent' : 'chat-bubble--customer'
          "
        >
          <div class="chat-sender">{{ msg.sender }}</div>
          <div class="chat-content">{{ msg.content }}</div>
          <div class="chat-time">{{ fmtTranscriptTime(msg.timestamp) }}</div>
        </div>
      </div>
    </div>

    <!-- diarized call turns -->
    <div
      v-else-if="!isChat && callTurns.length && activeView === 'bubbles'"
      class="chat-thread"
    >
      <div
        v-for="(t, i) in callTurns"
        :key="i"
        class="chat-msg"
        :class="t.speaker % 2 === 0 ? 'chat-msg--agent' : 'chat-msg--customer'"
      >
        <div
          class="chat-bubble"
          :class="
            t.speaker % 2 === 0 ? 'chat-bubble--agent' : 'chat-bubble--customer'
          "
        >
          <div class="chat-sender">{{ t.label }}</div>
          <div class="chat-content">{{ t.text }}</div>
        </div>
      </div>
    </div>

    <!-- raw fallback: unrecognised shape, or the operator chose Raw -->
    <pre v-else class="ct-raw">{{ text }}</pre>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  fmtTranscriptTime,
  parseCallTurns,
  parseChatMessages,
} from "../composables/useChatTranscript";

const props = withDefaults(
  defineProps<{
    text: string | null | undefined;
    isChat: boolean;
    /** Controlled view. Omit to let the component manage its own. */
    view?: "bubbles" | "raw";
    showToggle?: boolean;
  }>(),
  { showToggle: true },
);

const emit = defineEmits<{ (e: "update:view", v: "bubbles" | "raw"): void }>();

const internalView = ref<"bubbles" | "raw">("bubbles");
const activeView = computed(() => props.view ?? internalView.value);

function setView(v: "bubbles" | "raw") {
  internalView.value = v;
  emit("update:view", v);
}

const chatMessages = computed(() =>
  props.isChat ? parseChatMessages(props.text) : [],
);
const callTurns = computed(() =>
  props.isChat ? [] : parseCallTurns(props.text),
);

/** Whether a structured view is available at all — drives the toggle. */
const hasBubbles = computed(() =>
  props.isChat ? chatMessages.value.length > 0 : callTurns.value.length > 0,
);

// Reset to bubbles when the transcript changes, so opening a second record does
// not inherit a Raw choice made on the first.
watch(
  () => props.text,
  () => {
    internalView.value = "bubbles";
  },
);

defineExpose({ hasBubbles });
</script>

<style scoped>
.ct-root {
  min-width: 0;
}
.ct-toggle {
  margin: 0 0 8px auto;
}

/* Bubble styling matches InteractionDetailDrawer so a transcript looks the same
   wherever it is shown. Duplicated rather than imported because scoped styles do
   not cross the component boundary. */
.chat-view-toggle {
  display: inline-flex;
  border: 1px solid var(--border, #e5e7eb);
  border-radius: 6px;
  overflow: hidden;
}
.chat-view-btn {
  background: transparent;
  border: none;
  padding: 3px 8px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--muted, #6b7280);
  cursor: pointer;
}
.chat-view-btn:not(:last-child) {
  border-right: 1px solid var(--border, #e5e7eb);
}
.chat-view-btn--active {
  background: var(--brand, #6366f1);
  color: #fff;
}

.chat-thread {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 4px;
}
.chat-msg {
  display: flex;
}
.chat-msg--agent {
  justify-content: flex-start;
}
.chat-msg--customer {
  justify-content: flex-end;
}
.chat-bubble {
  max-width: 80%;
  padding: 8px 12px;
  border-radius: 12px;
  font-size: 13px;
  line-height: 1.5;
  word-break: break-word;
  white-space: pre-wrap;
}
.chat-bubble--agent {
  background: var(--surface-soft, #f1f5f9);
  color: var(--ink);
  border-bottom-left-radius: 4px;
}
.chat-bubble--customer {
  background: var(--brand, #6366f1);
  color: #fff;
  border-bottom-right-radius: 4px;
}
.chat-sender {
  font-size: 11px;
  font-weight: 700;
  margin-bottom: 2px;
  opacity: 0.7;
}
.chat-content {
  margin-bottom: 4px;
}
.chat-time {
  font-size: 10px;
  opacity: 0.5;
  text-align: right;
}

.ct-raw {
  margin: 0;
  font-size: 12px;
  font-family: ui-monospace, "Courier New", monospace;
  color: var(--ink);
  white-space: pre-wrap;
  word-break: break-word;
  background: var(--surface-soft, #f8f8f8);
  padding: 12px;
  border-radius: var(--radius-md, 6px);
  line-height: 1.6;
}
</style>
