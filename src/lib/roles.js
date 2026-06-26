export const VERIFIED_ROLES = [
  { value: "", label: "No verified role", family: "", rank: 0 },
  { value: "producer", label: "Producer", family: "producer", rank: 0 },
  { value: "producer_plus", label: "Producer+", family: "producer", rank: 1 },
  { value: "producer_plusplus", label: "Producer++", family: "producer", rank: 2 },
  { value: "artist", label: "Artist", family: "artist", rank: 0 },
  { value: "artist_plus", label: "Artist+", family: "artist", rank: 1 },
  { value: "artist_plusplus", label: "Artist++", family: "artist", rank: 2 },
  { value: "ar", label: "A&R", family: "ar", rank: 0 },
  { value: "ar_plus", label: "A&R+", family: "ar", rank: 1 },
  { value: "ar_plusplus", label: "A&R++", family: "ar", rank: 2 }
];

export const VERIFIED_ROLE_VALUES = new Set(VERIFIED_ROLES.map((role) => role.value));

export function verifiedRoleMeta(value) {
  return VERIFIED_ROLES.find((role) => role.value === value) || VERIFIED_ROLES[0];
}

export function verifiedRoleLabel(value) {
  return verifiedRoleMeta(value).label;
}

export function isArRole(value) {
  return verifiedRoleMeta(value).family === "ar";
}

export function canPlanSubmitToRole(plan, role) {
  const allowed = {
    free: new Set(["producer"]),
    plugg: new Set(["producer", "producer_plus", "artist", "artist_plus", "ar"]),
    pro: new Set(["producer", "producer_plus", "producer_plusplus", "artist", "artist_plus", "artist_plusplus", "ar", "ar_plus", "ar_plusplus"])
  };
  return (allowed[plan] || allowed.free).has(role);
}
