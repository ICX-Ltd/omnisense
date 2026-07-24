<script setup lang="ts">
import { computed, type Component } from "vue";
import {
  SlidersHorizontal, Users, TrendingUp, TrendingDown, Timer, Clock, BarChart3,
  LineChart, CircleCheck, MessageSquare, MessageSquareWarning, Coins, ShieldAlert,
  ShieldCheck, TriangleAlert, Siren, GraduationCap, ClipboardList, ClipboardCheck,
  FileSearch, Search, Scale, Building2, Car, Star, Ban, Target, Trophy, Sigma, Zap,
  RefreshCw, RefreshCcw, Hourglass, Music, Brain, Compass, Headphones, Mic, Radar,
  Plus, UserPlus, KeyRound, PoundSterling, CalendarRange, Sparkles, Megaphone,
  Gauge, Lightbulb, Quote,
} from "lucide-vue-next";

// Semantic accent palette — icons are coloured by MEANING, not decoration, so the
// app reads deliberate rather than rainbow. Each tone renders a solid-accent line
// glyph on a soft tint of the same hue (the "tinted chip" pattern).
export type IconTone =
  | "insights"
  | "analytics"
  | "success"
  | "warning"
  | "risk"
  | "people"
  | "value"
  | "neutral";

const TONES: Record<IconTone, string> = {
  insights: "#7c3aed", // violet — AI / narratives / extraction
  analytics: "#2b6cb0", // brand blue — charts / distributions / trends
  success: "#059669", // emerald — compliance / pass / what's working
  warning: "#d97706", // amber — alerts / attention / ratings
  risk: "#e11d48", // rose — errors / losses / threats
  people: "#4f46e5", // indigo — agents / dealers / users
  value: "#0d9488", // teal — opportunity / leads / cost
  neutral: "#64748b", // slate — time / queue / settings
};

// The single source of truth for every icon in the app: a semantic name → the
// Lucide glyph + its default tone. Change an icon or colour here and it updates
// everywhere. Callers pass `name`; `tone` can override the default per use.
const REGISTRY: Record<string, { icon: Component; tone: IconTone }> = {
  // filters / controls
  filters: { icon: SlidersHorizontal, tone: "neutral" },
  // people
  agents: { icon: Users, tone: "people" },
  dealer: { icon: Building2, tone: "people" },
  "user-add": { icon: UserPlus, tone: "people" },
  coaching: { icon: GraduationCap, tone: "people" },
  survey: { icon: ClipboardList, tone: "people" },
  // trends / charts
  trends: { icon: TrendingUp, tone: "analytics" },
  "trend-down": { icon: TrendingDown, tone: "risk" },
  lost: { icon: TrendingDown, tone: "risk" },
  distribution: { icon: BarChart3, tone: "analytics" },
  "loaded-date": { icon: LineChart, tone: "analytics" },
  performance: { icon: Gauge, tone: "analytics" },
  target: { icon: Target, tone: "analytics" },
  totals: { icon: Sigma, tone: "analytics" },
  // time
  "response-time": { icon: Timer, tone: "neutral" },
  recent: { icon: Clock, tone: "neutral" },
  pending: { icon: Hourglass, tone: "neutral" },
  status: { icon: RefreshCw, tone: "neutral" },
  calendar: { icon: CalendarRange, tone: "neutral" },
  // quality / compliance
  compliance: { icon: CircleCheck, tone: "success" },
  winning: { icon: Trophy, tone: "success" },
  trophy: { icon: Trophy, tone: "warning" },
  ratings: { icon: Star, tone: "warning" },
  factors: { icon: Lightbulb, tone: "warning" },
  // messages / voice
  chat: { icon: MessageSquare, tone: "analytics" },
  sentiment: { icon: MessageSquare, tone: "analytics" },
  objections: { icon: MessageSquareWarning, tone: "warning" },
  quotes: { icon: Quote, tone: "neutral" },
  // value
  opportunity: { icon: Coins, tone: "value" },
  cost: { icon: PoundSterling, tone: "value" },
  // risk / alerts
  warning: { icon: TriangleAlert, tone: "warning" },
  alert: { icon: Siren, tone: "risk" },
  vulnerability: { icon: ShieldAlert, tone: "warning" },
  threat: { icon: ShieldAlert, tone: "risk" },
  "not-purchased": { icon: Ban, tone: "risk" },
  // lists / analysis
  list: { icon: ClipboardList, tone: "neutral" },
  result: { icon: ClipboardCheck, tone: "neutral" },
  analysis: { icon: FileSearch, tone: "analytics" },
  search: { icon: Search, tone: "analytics" },
  comparison: { icon: Scale, tone: "neutral" },
  campaigns: { icon: Megaphone, tone: "analytics" },
  // AI / narrative / insights
  insights: { icon: Brain, tone: "insights" },
  narrative: { icon: Sparkles, tone: "insights" },
  vocab: { icon: Lightbulb, tone: "insights" },
  // pipeline / processing
  actions: { icon: Zap, tone: "warning" },
  retries: { icon: RefreshCcw, tone: "warning" },
  discover: { icon: Radar, tone: "analytics" },
  add: { icon: Plus, tone: "neutral" },
  // transcription / audio
  audio: { icon: Music, tone: "analytics" },
  transcription: { icon: Mic, tone: "neutral" },
  listen: { icon: Headphones, tone: "neutral" },
  semantic: { icon: Compass, tone: "analytics" },
  vehicle: { icon: Car, tone: "neutral" },
  // security
  password: { icon: KeyRound, tone: "neutral" },
  "two-factor": { icon: ShieldCheck, tone: "success" },
};

const props = withDefaults(
  defineProps<{ name: string; tone?: IconTone; size?: number }>(),
  { size: 22 },
);

const FALLBACK = { icon: ClipboardList, tone: "neutral" as IconTone };
const entry = computed(() => REGISTRY[props.name] ?? FALLBACK);
const color = computed(() => TONES[props.tone ?? entry.value.tone]);
const bg = computed(() => `color-mix(in srgb, ${color.value} 13%, transparent)`);
</script>

<template>
  <span class="icon-chip" :style="{ color, background: bg }">
    <component :is="entry.icon" :size="size" :stroke-width="2" :absolute-stroke-width="true" />
  </span>
</template>

<style scoped>
.icon-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  border-radius: 14px;
  flex-shrink: 0;
}
</style>
