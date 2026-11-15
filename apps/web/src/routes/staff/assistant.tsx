import { createFileRoute } from '@tanstack/react-router';
import { AssistantChat } from '../../components/assistant-chat';
import { DashboardShell } from '../../components/dashboard-shell';
import { opsNav } from '../../components/ops-nav';
import { getSession } from '../../lib/auth';
import { getTodayService } from '../../lib/schedule';

export const Route = createFileRoute('/staff/assistant')({
  component: StaffAssistant,
});

function StaffAssistant() {
  const session = getSession();
  const today = getTodayService();
  return (
    <DashboardShell
      title="AI Assistant"
      subtitle="Ask how to do things in the system"
      roleLabel={session?.role === 'admin' ? 'Admin' : 'Staff'}
      userName={session?.name}
      userEmail={session?.email ?? ''}
      todayService={`${today.name} — ${today.detail}`}
      nav={opsNav(session?.role, session?.permissions)}
      notificationsTo="/staff/notifications"
    >
      <AssistantChat audience="staff" />
    </DashboardShell>
  );
}
