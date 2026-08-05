<template>
  <svg
    :width="size"
    :height="size"
    :viewBox="`0 0 ${size} ${size}`"
    class="radar-svg"
    role="img"
    :aria-label="`Radar chart comparing ${series.length} models across ${axes.length} not-purchase reasons`"
  >
    <!-- Grid rings (25/50/75/100%) -->
    <polygon
      v-for="ring in rings"
      :key="ring.frac"
      :points="ring.points"
      fill="none"
      class="radar-grid"
    />
    <!-- Spokes -->
    <line
      v-for="(_, i) in axes"
      :key="'spoke-' + i"
      :x1="center" :y1="center"
      :x2="axisPoint(i, 1).x" :y2="axisPoint(i, 1).y"
      class="radar-grid"
    />
    <!-- Axis labels — wrapped onto up to 2 lines so a long reason name (e.g.
         "Different Brand") never runs past the chart edge. -->
    <text
      v-for="(a, i) in axes"
      :key="'label-' + i"
      :text-anchor="labelAnchor(i)"
      class="radar-axis-label"
    >
      <tspan
        v-for="(line, li) in labelLines(a)"
        :key="li"
        :x="labelPoint(i).x"
        :y="labelPoint(i).y + (li - (labelLines(a).length - 1) / 2) * 12"
      >{{ line }}</tspan>
    </text>

    <!-- Series polygons (drawn under markers) -->
    <g v-for="s in series" :key="'poly-' + s.label">
      <polygon :points="seriesPoints(s)" :fill="s.color" fill-opacity="0.1" :stroke="s.color" stroke-width="2" stroke-linejoin="round" />
    </g>

    <!-- Vertex markers with a hover/focus hit target + native tooltip -->
    <g v-for="s in series" :key="'pts-' + s.label">
      <g v-for="(v, i) in s.values" :key="'pt-' + s.label + '-' + i">
        <circle
          :cx="vertex(i, v).x" :cy="vertex(i, v).y"
          r="12" fill="transparent" tabindex="0"
        >
          <title>{{ s.label }} — {{ axes[i] }}: {{ v }}%</title>
        </circle>
        <circle
          :cx="vertex(i, v).x" :cy="vertex(i, v).y"
          r="4" :fill="s.color" class="radar-marker-ring"
        />
      </g>
    </g>
  </svg>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    axes: string[];
    series: Array<{ label: string; color: string; values: number[] }>;
    size?: number;
    max?: number;
  }>(),
  { size: 320, max: 100 },
);

const center = computed(() => props.size / 2);
// The plotted polygon's radius, and how far outside it axis labels sit —
// both fixed ratios of `size` so the layout scales with the size prop while
// leaving a consistent margin for label text to avoid running off the edge
// (see labelLines: wrapping keeps any single line short enough to fit that margin).
const radius = computed(() => props.size * 0.24);
const labelRadius = computed(() => props.size * 0.29);

function angleFor(i: number) {
  return (Math.PI * 2 * i) / props.axes.length - Math.PI / 2;
}
function axisPoint(i: number, frac: number) {
  const a = angleFor(i);
  return {
    x: center.value + Math.cos(a) * radius.value * frac,
    y: center.value + Math.sin(a) * radius.value * frac,
  };
}
function vertex(i: number, value: number) {
  const frac = Math.max(0, Math.min(1, value / props.max));
  return axisPoint(i, frac);
}
function labelPoint(i: number) {
  const a = angleFor(i);
  return {
    x: center.value + Math.cos(a) * labelRadius.value,
    y: center.value + Math.sin(a) * labelRadius.value,
  };
}
function labelAnchor(i: number): "start" | "middle" | "end" {
  const a = angleFor(i);
  const cos = Math.cos(a);
  if (Math.abs(cos) < 0.35) return "middle";
  return cos > 0 ? "start" : "end";
}
// Split a multi-word axis label onto separate lines so no single rendered
// line is longer than its longest word — keeps text inside the chart's
// fixed label margin regardless of anchor (start/middle/end).
function labelLines(label: string): string[] {
  return label.split(' ');
}
function seriesPoints(s: { values: number[] }) {
  return s.values.map((v, i) => { const p = vertex(i, v); return `${p.x.toFixed(1)},${p.y.toFixed(1)}`; }).join(" ");
}

const rings = computed(() =>
  [0.25, 0.5, 0.75, 1].map((frac) => ({
    frac,
    points: props.axes
      .map((_, i) => { const p = axisPoint(i, frac); return `${p.x.toFixed(1)},${p.y.toFixed(1)}`; })
      .join(" "),
  })),
);
</script>

<style scoped>
.radar-svg {
  display: block;
  max-width: 100%;
  height: auto;
}
.radar-grid {
  stroke: var(--ink, #121a32);
  stroke-opacity: 0.12;
  stroke-width: 1;
}
.radar-axis-label {
  fill: var(--ink, #121a32);
  opacity: 0.65;
  font-size: 11px;
}
.radar-marker-ring {
  stroke: var(--surface, #fff);
  stroke-width: 2;
}
</style>
