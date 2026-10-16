/**
 * Go-Auth Pilot Users
 *
 * Phone numbers (last 10 digits, no country code) whose authentication
 * is handled by the Go backend service instead of Supabase directly.
 *
 * Add more 10-digit phone numbers to this list as you onboard additional
 * internal / pilot users to the Go service.
 *
 * The `go_auth_enabled` feature flag must ALSO be true for these users
 * to be routed to the Go service; this list acts as an additional
 * per-user gate on top of the global flag.
 */
export const GO_AUTH_USERS: ReadonlySet<string> = new Set([
  "7006342430",
  "7021257084",
  "7338098798",
  "9611687011",
  "7483879015",
  "9145375770",
  "6369729548",
  "9826058007",
  "9036214225",
  "9182031523",
  "7717750403",
  "9831270111",
  "9419057304",
  "7219361661",
  "9438046117",
  "9438046116",
  "1020050002",
  "1020050001",
  "9090909999",
  "9008022378",
  "7894561230",
  "9007140001",
  "8105809090",
  "7908031178",
  "7501672888",
  "9103181291",
  "9103181292",
  "9858817293",
  "7501672228",
  "9103181221",
  "9103181222",
  "9419000111",
  "9906990612",
  "8899012345",
  "9419455591",
  "9419455590",
  "9419455592",
  "123456789",
  "12345678",
  "9419455595",
  "8123547177",
  "1234567890",
  "8123547178",
  "8123547179",
  "1234567892",
  "8123547176",
  "9901226307",
  "9711786126",
  "2345234523",
]);

/**
 * Returns true if the given phone number (any format) should use the
 * Go backend for authentication.
 *
 * Normalises the input to the last 10 digits before checking the list,
 * so callers don't need to pre-process the phone.
 */
export function isGoAuthUser(phone: string): boolean {
  const last10 = phone.replace(/\D/g, "").slice(-10);
  return GO_AUTH_USERS.has(last10);
}
