import { ApiPath } from "./api";

export const RecordingPath = {
  transcribe: (id: string) => `${ApiPath.Recordings}/${id}/transcribe`,
  insights: (id: string) => `${ApiPath.Recordings}/${id}/insights`,
  transcript: (id: string) => `${ApiPath.Recordings}/${id}/transcript`,
  insight: (id: string) => `${ApiPath.Recordings}/${id}/insight`,

  requeue: (id: string) => `${ApiPath.Recordings}/${id}/requeue`,

  list: ApiPath.Recordings,
  summary: `${ApiPath.Recordings}/summary`,
  batchTranscribe: `${ApiPath.Recordings}/batch/transcribe`,
  batchInsights: `${ApiPath.Recordings}/batch/insights`,
  batchInsightsChats: `${ApiPath.Recordings}/batch/insights/chats`,
  batchRequeueErrors: `${ApiPath.Recordings}/batch/requeue-errors`,
  batchReprocessInsights: `${ApiPath.Recordings}/batch/reprocess-insights`,
  keytermSuggestions: `${ApiPath.Recordings}/keyterm-suggestions`,
  lowConfidence: `${ApiPath.Recordings}/low-confidence`,
  batchJobs: `${ApiPath.Recordings}/jobs`,
  batchJob: (id: string) => `${ApiPath.Recordings}/jobs/${id}`,
} as const;
