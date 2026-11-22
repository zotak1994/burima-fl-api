'use strict';
const mongoose = require( 'mongoose' );
const { Schema } = require( 'mongoose' );
const { toAmount } = require( '../../utils' );

/**
 * One line of a sale, shaped exactly like a purchase line so the stock side
 * can treat the two the same.
 *
 * `rate` is the MRP it sold at and `amount` is rate times quantity —
 * which is the whole of a sale's arithmetic.
 */
const itemSchema = new Schema( {
    'product': {
        'type': Schema.Types.ObjectId,
        'ref': 'product',
        'required': true
    },
    // Snapshot of the product name at the time of sale, so a renamed or
    // deleted product still prints correctly on an old bill.
    'name': {
        'type': String,
        'trim': true
    },
    'qty': {
        // Bottles, always a whole number of main units.
        'type': Number,
        'required': true,
        'min': 1,
        'validate': {
            'validator': Number.isInteger,
            'message': 'Quantity must be a whole number of bottles.'
        }
    },
    'rate': {
        // Per bottle, as sold: the product's MRP unless the line says
        // otherwise. A line that sends neither rate nor amount takes the MRP.
        'type': Number,
        'required': true,
        'min': 0,
        'set': toAmount
    },
    'amount': {
        'type': Number,
        'required': true,
        'min': 0,
        'set': toAmount
    }
}, { '_id': false } );

/**
 * A sale: stock leaving the shop against a bill.
 *
 * The mirror image of a purchase. A draft touches no stock; confirming makes
 * every line count against its product's stock, which is what makes stock on
 * hand fall. Confirming is refused if a line would oversell.
 */
class Sale {

    initSchema() {
        const schema = new Schema( {
            'shop': {
                // Stock leaves one outlet, so a sale belongs to one.
                'type': Schema.Types.ObjectId,
                'ref': 'shop',
                'required': true,
                'index': true
            },
            'date': {
                // The only thing that identifies a sale. An off-shop sale has
                // no bill number worth keeping and no customer to name, so the
                // date it happened on is the whole of its header.
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
                // The sum of the line amounts. A sale has no discount and no
                // round off, so netAmount is the same figure.
                'type': Number,
                'default': 0,
                'min': 0,
                'set': toAmount
            },
            'netAmount': {
                // What the customer paid: the lines added up.
                'type': Number,
                'default': 0,
                'set': toAmount
            },
            'status': {
                // A draft touches no stock. Confirming is what makes its
                // lines count against stock.
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

        // The listing reads one outlet's sales newest first.
        schema.index( { 'shop': 1, 'date': -1 } );
        try {
            mongoose.model( 'sale', schema );
        } catch ( e ) {
            // Already registered on a previous require.
        }
    }

    getInstance() {
        this.initSchema();
        return mongoose.model( 'sale' );
    }
}

module.exports = { Sale };
