import { createFileRoute } from '@tanstack/react-router';
import { AssistantChat } from '../../components/assistant-chat';
import { DashboardShell } from '../../components/dashboard-shell';
import { patientNav } from '../../components/patient-nav';
import { getSession } from '../../lib/auth';
import { getTodayService } from '../../lib/schedule';

export const Route = createFileRoute('/app/assistant')({
  component: PatientAssistant,
});

function PatientAssistant() {
  const session = getSession();
  const today = getTodayService();
  return (
    <DashboardShell
      title="AI Assistant"
      subtitle="Ask about services, schedules and how to use the app"
      roleLabel="Patient"
      userName={session?.name}
      userEmail={session?.email ?? ''}
      todayService={`${today.name} — ${today.detail}`}
      nav={patientNav}
      notificationsTo="/app/notifications"
    >
      <AssistantChat audience="patient" />
    </DashboardShell>
  );
}
