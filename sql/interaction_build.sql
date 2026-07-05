use ai_insight

create procedure sp_temp
as

SELECT

	NEWID()                                                         AS [id],
    'openai' AS [provider],	--or 'openai'                                      
	historycall.[call recording] AS [recordingUrl],
    NULL AS [storageKey],
	'pending_transcription' AS [status],
	NULL AS [lastError],
    SYSUTCDATETIME() AS [createdAt],
    SYSUTCDATETIME() AS [updatedAt],
	'maxcontact' AS [interactionSource],
    LOWER(history_type) AS [interactionType],
    CAST(history_id AS VARCHAR(50)) AS [interactionId],
    CAST(reference_id AS VARCHAR(50)) AS [interactionTpsId],
	'Parity' AS campaign,
    historycall.start_date_time AS interactionDateTime,
    historycall.user_routing AS agent,
    historycall.result_code AS outcome,
    allocationqueue.maturitydate AS maturityDate,
    null AS daysToMaturityAtInteraction,
    allocationqueue.make AS vehicleMake,
    allocationqueue.model AS vehicleModel,
    list.list AS campaign_original,
    allocationqueue.dealername AS dealer
FROM bi.historycall WITH(NOLOCK)
INNER JOIN bi.Opportunity WITH(NOLOCK) on Opportunity.[IDaction] = historycall.reference_id 
INNER JOIN dim.list WITH(NOLOCK) on [original list id] = list.idlist
INNER JOIN dim.list list2 WITH(NOLOCK) on [list id] = list2.idlist
INNER JOIN maxcontact.allocation.allocationqueue ON  historycall.reference_id  = allocationqueue.idaction
WHERE (
	   (historycall.start_date_time  BETWEEN '2026-05-01' AND '2026-05-07 23:59:59')
	)
AND ISNULL(historycall.[call recording],'') <> ''
AND historycall.result_code IN ('FPI','NI','ALRPURCOM')
AND list2.listgrouping = 'NMGB Survey'
--AND CAST(reference_id AS VARCHAR(50)) IN (
--)

--select * from dim.list where name like '%NMGB%'