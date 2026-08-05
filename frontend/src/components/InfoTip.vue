<template>
  <span class="info-tip" ref="root">
    <button
      type="button"
      class="info-tip-btn"
      :aria-expanded="open"
      aria-label="What does this show?"
      @click.stop="toggle"
    >
      <Info :size="12" :stroke-width="2.6" />
    </button>
    <div v-if="open" class="info-tip-pop" role="tooltip">{{ text }}</div>
  </span>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from "vue";
import { Info } from "lucide-vue-next";

defineProps<{ text: string }>();
const open = ref(false);
const root = ref<HTMLElement | null>(null);

function toggle() {
  open.value = !open.value;
}
// Any click outside this instance's button/popover closes it — including a
// click that opens a different InfoTip, so only one is ever open at a time.
function onDocClick(e: MouseEvent) {
  if (open.value && root.value && !root.value.contains(e.target as Node)) open.value = false;
}
function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") open.value = false;
}

onMounted(() => {
  document.addEventListener("click", onDocClick);
  document.addEventListener("keydown", onKey);
});
onBeforeUnmount(() => {
  document.removeEventListener("click", onDocClick);
  document.removeEventListener("keydown", onKey);
});
</script>

<style scoped>
.info-tip {
  position: relative;
  display: inline-flex;
  vertical-align: middle;
  margin-left: 6px;
}
.info-tip-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 17px;
  height: 17px;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: var(--surface-soft);
  color: var(--muted);
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
}
.info-tip-btn:hover,
.info-tip-btn[aria-expanded="true"] {
  color: var(--brand, #6366f1);
  border-color: var(--brand, #6366f1);
}
.info-tip-pop {
  position: absolute;
  top: 22px;
  left: 0;
  z-index: 80;
  width: 280px;
  max-width: 75vw;
  background: var(--surface, #fff);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 12.5px;
  font-weight: 400;
  line-height: 1.5;
  color: var(--ink);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.18);
}
</style>
