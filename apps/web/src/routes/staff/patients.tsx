import { createFileRoute, Outlet } from '@tanstack/react-router';

/**
 * Layout route for the shared staff/admin patient register.
 *
 * The list lives in patients.index.tsx and the record in
 * patients.$patientId.tsx. Keeping this file as an Outlet is what lets the
 * child route render; without it the list masked every patient record.
 */
export const Route = createFileRoute('/staff/patients')({
  component: PatientsLayout,
});

function PatientsLayout() {
  return <Outlet />;
}
