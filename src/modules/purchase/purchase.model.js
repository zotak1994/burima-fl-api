'use strict';
const mongoose = require( 'mongoose' );
const { Schema } = require( 'mongoose' );
const uniqueValidator = require( 'mongoose-unique-validator' );
const { toAmount } = require( '../../utils' );

/**
 * One line of a stock-in. Lines are embedded rather than kept in their own
 * collection: a purchase is always read and written whole, and the line
 * carries its own figures so a later change to the product never rewrites
 * history.
 *
 * `amount` is the line's record — it is what the supplier's invoice charges
 * for the line, and it is what the totals are summed from. `rate` is derived
 * from it (amount ÷ qty) and kept only to show and to print: a rate rounded
 * to paise multiplied back by the quantity rarely returns the invoice's own
 * figure, so it is never the thing the money is computed from.
 */
const itemSchema = new Schema( {
    'product': {
        'type': Schema.Types.ObjectId,
        'ref': 'product',
        'required': true
    },
    // Snapshot of the product name as it was when stocked in, so a renamed or
    // deleted product still prints correctly on an old purchase.
    'name': {
        'type': String,
        'trim': true
    },
    'qty': {
        // Bottles, and only bottles: whatever cases the invoice is written in
        // are multiplied out before they get here, so this is always a whole
        // number of main units.
        'type': Number,
        'required': true,
        'min': 1,
        'validate': {
            'validator': Number.isInteger,
            'message': 'Quantity must be a whole number of bottles.'
        }
    },
    'rate': {
        // Per bottle, for THIS invoice, to paise. Derived by the service from
        // amount ÷ qty; a rate sent by a client is only a fallback for a line
        // that carries no amount. Never written back to the product.
        'type': Number,
        'required': true,
        'min': 0,
        'set': toAmount
    },
    'amount': {
        // What the invoice charges for this line, to paise. This is the
        // authoritative figure — the one the totals add up.
        'type': Number,
        'required': true,
        'min': 0,
        'set': toAmount
    }
}, { '_id': false } );

class Purchase {

    initSchema() {
        const schema = new Schema( {
            'shop': {
                // Stock belongs to one outlet, so a purchase does too.
                'type': Schema.Types.ObjectId,
                'ref': 'shop',
                'required': true,
                'index': true
            },
            'invoiceNo': {
                'type': String,
                'required': true,
                'trim': true
            },
            'passNo': {
                'type': String,
                'required': true,
                'trim': true
            },
            'date': {
                'type': Date,
                'required': true
            },
            'items': {
                'type': [ itemSchema ],
                'default': []
            },
            'totalQty': {
                'type': Number,
                'default': 0,
                'min': 0
            },
            'totalAmount': {
                // Gross: the sum of the line amounts, before the invoice's
                // own deductions and levies below.
                'type': Number,
                'default': 0,
                'min': 0,
                'set': toAmount
            },
            // ---- invoice charges, entered by hand on the supplier's bill ---
            // The four below are what the client sends; `roundOff` and
            // `netAmount` after them are worked out from these.
            'lessRebate': {
                // Deducted from the gross.
                'type': Number,
                'default': 0,
                'min': 0,
                'set': toAmount
            },
            'specialPurpose': {
                // Special purpose levy, added.
                'type': Number,
                'default': 0,
                'min': 0,
                'set': toAmount
            },
            'roundOffToGovt': {
                // Government rounding adjustment: may go either way, so no
                // minimum.
                'type': Number,
                'default': 0,
                'set': toAmount
            },
            'tcs': {
                // Tax collected at source, added.
                'type': Number,
                'default': 0,
                'min': 0,
                'set': toAmount
            },
            'roundOff': {
                // Whatever it takes to bring the bill to a whole rupee, so it
                // may go either way and has no minimum. Computed by the
                // service — a value sent by a client is ignored.
                'type': Number,
                'default': 0,
                'set': toAmount
            },
            'netAmount': {
                // What the invoice actually comes to, always a whole rupee.
                // Computed by the service from the gross and the charges above
                // — never taken from the client, the same way totalAmount is
                // not. No minimum: a part-entered draft can carry a rebate
                // before its line amounts are typed, and that has to save.
                'type': Number,
                'default': 0,
                'set': toAmount
            },
            'status': {
                // A draft touches no stock. Confirming posts every line to
                // the products' inventory, once.
                'type': String,
                'enum': [ 'draft', 'confirmed' ],
                'default': 'draft',
                'index': true
            },
            'confirmedAt': {
                'type': Date
            },
            'confirmedBy': {
                'type': Schema.Types.ObjectId,
                'ref': 'user'
            },
            'createdBy': {
                'type': Schema.Types.ObjectId,
                'ref': 'user'
            },
            'updatedBy': {
                'type': Schema.Types.ObjectId,
                'ref': 'user'
            }
        }, { 'timestamps': true } );

        schema.plugin( uniqueValidator, { 'message': '{PATH} already exists' } );
       
        try {
            mongoose.model( 'purchase', schema );
        } catch ( e ) {

        }

    }

    getInstance() {
        this.initSchema();
        return mongoose.model( 'purchase' );
    }
}

module.exports = { Purchase };
