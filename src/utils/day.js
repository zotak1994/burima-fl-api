'use strict';
/**
 * The one dayjs in the backend, with the UTC plugin loaded.
 *
 * Every date the stock side stores is a calendar date pinned to midnight UTC —
 * the business day an invoice falls on, not an instant — because the snapshot
 * pipeline groups on MongoDB's `$year/$month/$dayOfMonth`, which read a stored
 * Date in UTC. So the rule across the backend is: parse and build business
 * dates with `dayjs.utc(...)`, and keep plain `dayjs()` only for an actual
 * instant (a confirmation timestamp, an OTP expiry, a filename stamp).
 *
 * Registering the plugin here, once, is why this module exists: requiring
 * dayjs directly elsewhere would give an instance without `.utc()`.
 */
const dayjs = require( 'dayjs' );
const utc = require( 'dayjs/plugin/utc' );
dayjs.extend( utc );

module.exports = dayjs;
