import { createRootRoute, Outlet } from '@tanstack/react-router';
import { EditConflictNotice } from '../components/edit-conflict-notice';

export const Route = createRootRoute({
  component: RootComponent,
});

/**
 * Chrome-free root. Each area renders its own shell:
 * public pages use `PublicHeader`, dashboards use `DashboardShell`.
 */
function RootComponent() {
  return (
    <>
      <Outlet />
      {/* A refused save can happen on any screen, so the notice lives here. */}
      <EditConflictNotice />
    </>
  );
}
