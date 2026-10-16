/**
 * Lock settings shared by every workflow that locks a cart. Cart completion
 * holds the lock for the whole checkout, so mutations must be able to wait
 * for it rather than fail fast, and all workflows must agree on the TTL.
 */

/**
 * Maximum time (in seconds) to wait for a cart lock before failing.
 */
export const CART_LOCK_TIMEOUT = 30

/**
 * Expiration (in seconds) of a cart lock, in case it is never released.
 */
export const CART_LOCK_TTL = 60 * 2
