<template>
  <svg
    v-if="points.length > 1"
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
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(
  defineProps<{ points: number[]; color?: string; width?: number; height?: number }>(),
  { color: "#6366f1", width: 130, height: 30 },
);

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
.spark {
  display: block;
}
</style>
