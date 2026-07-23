<template>
  <div v-if="points.length > 1" class="spark-wrap" :style="{ background: plateBg }">
    <svg
      :width="width"
      :height="height"
      class="spark"
      :viewBox="`0 0 ${width} ${height}`"
      preserveAspectRatio="none"
    >
      <polyline
        :points="linePoints"
        fill="none"
        :stroke="color"
        stroke-width="1.5"
        stroke-linejoin="round"
        stroke-linecap="round"
      />
      <circle :cx="lastX" :cy="lastY" r="2.2" :fill="color" />
    </svg>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(
  defineProps<{ points: number[]; color?: string; width?: number; height?: number }>(),
  { color: "#6366f1", width: 130, height: 30 },
);

// A subtle plate tinted with the line colour, so every sparkline sits in a
// consistent little chart container instead of floating as a bare line.
const plateBg = computed(() => `color-mix(in srgb, ${props.color} 8%, transparent)`);

const coords = computed<Array<[number, number]>>(() => {
  const n = props.points.length;
  const min = Math.min(...props.points);
  const max = Math.max(...props.points);
  const span = max - min || 1;
  const pad = 3;
  return props.points.map((v, i) => {
    const x = n === 1 ? props.width / 2 : (i / (n - 1)) * (props.width - pad * 2) + pad;
    const y = props.height - pad - ((v - min) / span) * (props.height - pad * 2);
    return [x, y];
  });
});
const linePoints = computed(() =>
  coords.value.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" "),
);
const last = computed<[number, number]>(() => coords.value[coords.value.length - 1] ?? [0, 0]);
const lastX = computed(() => last.value[0]);
const lastY = computed(() => last.value[1]);
</script>

<style scoped>
.spark-wrap {
  display: inline-flex;
  padding: 5px 8px;
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--ink, #121a32) 6%, transparent);
}
.spark {
  display: block;
}
</style>
