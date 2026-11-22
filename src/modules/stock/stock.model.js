'use strict';
const mongoose = require( 'mongoose' );
const { Schema } = require( 'mongoose' );
const { toAmount } = require( '../../utils' );

/**
 * The daily stock snapshot — the only collection the stock side owns.
 *
 * Stock itself is not stored anywhere as a fact. The confirmed purchases and
 * sales ARE the record: a purchase's lines are stock in, a sale's lines are
 * stock out, and everything else is worked out from them.
 *
 * This collection exists for one reason: so a report over a date range does
 * not have to unwind every bill the shop has ever written. One row per
 * product per day, and only for a day that actually moved — a product that
 * neither arrived nor sold on a date simply has no row, and reads as zero.
 *
 * A row holds only what moved THAT DAY. No opening, no closing, no running
 * balance. That is deliberate: a row depends on nothing but the documents
 * dated that day, so correcting a June bill rewrites June's rows and touches
 * nothing in July. The balances a report shows are added up at read time:
 *
 *   opening at D  = Σ ( inQty − outQty ) over all rows dated before D
 *   closing       = opening + Σ in − Σ out inside the window
 *
 * `product.inventory` is the same sum with no date limit, cached on the
 * product so the catalogue and the low-stock badges can show one number
 * without a lookup. It is always rewritten from this collection, never
 * incremented, so the two cannot drift.
 */
const snapshotSchema = new Schema( {
    'shop': {
        'type': Schema.Types.ObjectId,
        'ref': 'shop',
        'required': true
    },
    'product': {
        'type': Schema.Types.ObjectId,
        'ref': 'product',
        'required': true
    },
    /**
     * The business day, at midnight UTC. Deliberately UTC and not the
     * server's zone: the date on a bill is a calendar date, not an instant,
     * and 'YYYY-MM-DD' from the browser already arrives as UTC midnight.
     */
    'date': {
        'type': Date,
        'required': true
    },
    'inQty': {
        // Bottles that arrived on this day, from confirmed purchases.
        'type': Number,
        'default': 0
    },
    'outQty': {
        // Bottles that left on this day, from confirmed sales.
        'type': Number,
        'default': 0
    },
    'inAmount': {
        // What the day's arrivals cost.
        'type': Number,
        'default': 0,
        'set': toAmount
    },
    'outAmount': {
        // What the day's sales came to.
        'type': Number,
        'default': 0,
        'set': toAmount
    }
}, { 'timestamps': true } );

// One row per product per day per shop. The unique index is what makes a
// recalculation safe to repeat: a rewrite replaces the row rather than
// adding a second one for the same day.
snapshotSchema.index(
    { 'shop': 1, 'product': 1, 'date': 1 }, { 'unique': true }
);
// "Everything this shop did in this window", for the day-by-day view.
snapshotSchema.index( { 'shop': 1, 'date': 1 } );

class StockSnapshot {
    initSchema() {
        try {
            mongoose.model( 'stocksnapshot', snapshotSchema );
        } catch ( e ) {
            // Already registered on a previous require.
        }
    }

    getInstance() {
        this.initSchema();
        return mongoose.model( 'stocksnapshot' );
    }
}

// The module's model for the CalmController plumbing.
const Stock = StockSnapshot;

module.exports = { Stock, StockSnapshot };
