-- currently hooked up to github personal repository

cd "C:/DATA/ICX/ICX Applications/JakartaGit/auto-ignite-insights"
git add .
git commit -m "add..."
git push origin main




################################
TO DO 
################################

tidy up DATA

update [app].[interactions] 
set [status] = 'error empty transcript'
from [app].[interactions] 
where interactiontype = 'call'
and [status] = 'transcribed'
and '' = (select [text] from app.interaction_transcripts
		where recordingid =  [interactions].id)

        
rerun errorrs
reset status on previous
fix scores on unanswered calls and chats
filter out errors and no transcripts

get summary page looking decent

buld narrative display page to show that off

drop down for all narratives

check "unknown" chips on summary page panels



