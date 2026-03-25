import { ApiPath } from "./api";

export const RecordingPath = {
  transcribe: (id: string) => `${ApiPath.Recordings}/${id}/transcribe`,
  insights: (id: string) => `${ApiPath.Recordings}/${id}/insights`,
  transcript: (id: string) => `${ApiPath.Recordings}/${id}/transcript`,
  insight: (id: string) => `${ApiPath.Recordings}/${id}/insight`,

  summary: `${ApiPath.Recordings}/summary`,
  batchTranscribe: `${ApiPath.Recordings}/batch/transcribe`,
  batchInsights: `${ApiPath.Recordings}/batch/insights`,
  batchInsightsChats: `${ApiPath.Recordings}/batch/insights/chats`,
  batchJobs: `${ApiPath.Recordings}/jobs`,
  batchJob: (id: string) => `${ApiPath.Recordings}/jobs/${id}`,
} as const;
