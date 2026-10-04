export function Avatar({ profile, big }: { profile: { firstName: string; lastName: string; photo: string | null }; big?: boolean }) {
  const initials = `${profile.firstName[0] ?? ''}${profile.lastName[0] ?? ''}`.toUpperCase();
  return <span className={`pz-avatar ${big ? 'big' : ''}`}>{profile.photo ? <img src={profile.photo} alt="" /> : initials}</span>;
}
