/**
 * Public user shape shared by login, /me and the profile-completion endpoint.
 *
 * The database still stores the existing `provider` and `profileComplete`
 * fields. The API exposes the names the web app uses (`authProvider` and
 * `profileCompleted`) so the client can stay independent of the schema names.
 */
export function presentUser(user) {
  return {
    id: String(user._id),
    name: user.fullName,
    email: user.email,
    role: user.role,
    authProvider: user.provider,
    profileCompleted: user.role === 'patient' ? user.profileComplete !== false : true,
    avatarUrl: user.avatarUrl ?? '',
  };
}
