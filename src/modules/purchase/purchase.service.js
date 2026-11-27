'use strict';
const mongoose = require( 'mongoose' );
const dayjs = require( '../../utils/day' );
const { CalmService } = require( '../../../system/core/CalmService' );
const { CalmError } = require( '../../../system/core/CalmError' );
const { stockEngine } = require( '../stock/stock.engine' );
const {
    money, clientFigure, normaliseLines, assertNotFutureDate, listFilters
} = require( '../stock/stock-lines' );

/**
 * The invoice charges, in the order they appear on a supplier's bill, with
 * the sign each one carries into the net amount.
 *   subtotal = gross − lessRebate + specialPurpose + roundOffToGovt + tcs
 *   roundOff = round( subtotal ) − subtotal
 *   net      = round( subtotal )
 * `roundOffToGovt` may be negative; the others may not.
 *
 * The entry screen works all of this out as the shopkeeper types, so what it
 * sends is what gets stored. The formula above is the fallback for a client
 * that leaves a figure out — see resolveCharges.
 */
const CHARGES = [
    { 'key': 'lessRebate', 'sign': -1, 'label': 'Less rebate', 'signed': false },
    { 'key': 'specialPurpose', 'sign': 1, 'label': 'Special purpose', 'signed': false },
    { 'key': 'roundOffToGovt', 'sign': 1, 'label': 'Round off to govt', 'signed': true },
    { 'key': 'tcs', 'sign': 1, 'label': 'TCS', 'signed': false }
];

/**
 * Validate the charge fields and settle the round off and the net amount.
 * Only the keys the caller actually sent are taken from `data`; anything else
 * falls back to what is already stored, so editing one field cannot blank the
 * others.
 *
 * `roundOff` and `netAmount` are stored as the client sent them — the entry
 * screen has already worked them out, and recomputing them here would only be
 * a second opinion. They are still checked for being numbers, and either one
 * left out is derived from the other.
 * @param { Object } data - the incoming payload
 * @param { Object } current - the stored purchase, or {} when creating
 * @param { number } gross - the line total a missing figure is computed from
 * @returns { Object } the charge fields plus roundOff and netAmount
 */
function resolveCharges( data, current, gross ) {
    const out = {};
    const errors = [];
    let net = money( gross );

    CHARGES.forEach( ( charge ) => {
        const sent = data[ charge.key ];
        const raw = sent === undefined || sent === null || sent === ''
            ? ( current[ charge.key ] || 0 )
            : sent;
        const value = Number( raw );
        if ( !Number.isFinite( value ) ) {
            errors.push( `${ charge.label } is not a number` );
            return;
        }
        if ( !charge.signed && value < 0 ) {
            errors.push( `${ charge.label } cannot be negative` );
            return;
        }
        out[ charge.key ] = money( value );
        net += charge.sign * out[ charge.key ];
    } );

    if ( errors.length ) {
        throw new CalmError( 'VALIDATION_ERROR', errors.join( '; ' ) );
    }

    // Both as sent; one of them missing is derived from the other; neither
    // sent falls back to the bill being settled in whole rupees.
    const sentRound = clientFigure( data.roundOff, 'Round off', true );
    const sentNet = clientFigure( data.netAmount, 'Net amount', true );
    if ( sentRound !== null && sentNet !== null ) {
        out.roundOff = sentRound;
        out.netAmount = sentNet;
    } else if ( sentNet !== null ) {
        out.netAmount = sentNet;
        out.roundOff = money( sentNet - net );
    } else if ( sentRound !== null ) {
        out.roundOff = sentRound;
        out.netAmount = money( net + sentRound );
    } else {
        const whole = Math.round( net );
        out.roundOff = money( whole - net );
        out.netAmount = money( whole );
    }
    return out;
}

class PurchaseService extends CalmService {
    // Setting Global Populate to apply in Get All & Get Single
    populateFields = [
        { path: 'shop', select: 'name phone displayNumber' },
        { path: 'items.product', select: 'name code mainUnit alternateUnit' },
        { path: 'createdBy', select: 'name email' },
        { path: 'confirmedBy', select: 'name email' }
    ];
    // Fields matched by the `search` query param
    searchFields = [ 'invoiceNo', 'passNo' ];
    constructor( model ) {
        super( model );
    }

    /**
     * Newest first by default: a stock-in screen is about what just arrived,
     * not about a manually arranged order.
     */
    async getAll( query, ops = {} ) {
        // ?from=&to= (inclusive days) and ?createdBy= — see listFilters.
        // eslint-disable-next-line no-param-reassign
        query = listFilters( query );
        if ( !query.sortBy && !query.sort ) {
            // eslint-disable-next-line no-param-reassign
            query = { ...query, sortBy: { 'date': -1, 'createdAt': -1 } };
        }
        return super.getAll( query, ops );
    }

    /**
     * Validate the lines and work out the totals. A thin wrapper over the
     * shared stock-document helper, kept as a method so a purchase's own
     * callers read the same as they did.
     * @param { Array } items
     * @param { * } shopId
     * @param { Object } [totals]
     */
    async normaliseItems( items, shopId, totals = {} ) {
        return normaliseLines( { items, shopId, totals } );
    }

    /** Create a purchase. Always a draft — nothing reaches stock yet. */
    async insert( data ) {
        const payload = { ...data };
        assertNotFutureDate( payload.date );
        const totals = await this.normaliseItems(
            payload.items, payload.shop, payload
        );
        payload.items = totals.items;
        payload.totalQty = totals.totalQty;
        payload.totalAmount = totals.totalAmount;
        Object.assign( payload, resolveCharges( payload, {}, totals.totalAmount ) );
        payload.status = 'draft';
        return super.insert( payload );
    }

    /**
     * Edit a purchase — a draft, or a confirmed one.
     *
     * A confirmed purchase has already moved stock, and an admin still has to
     * be able to fix a mistyped quantity, rate or date on it — adding a line,
     * removing one, or changing a quantity either way. So the edit is applied
     * and the stock is worked out again in one transaction, for every product
     * either version of the bill mentions and on both the old date and the
     * new one. A line dropped from the bill is covered by that: its product
     * is reconsidered, finds this bill no longer buys it, and comes back
     * down. Correcting a June invoice in August repairs June's figures as
     * well as today's shelf count.
     */
    async update( id, data ) {
        // The stored charges come along: editing the lines has to recompute
        // the net amount, and editing one charge must not blank the rest.
        // The lines and the date come along so the stock side knows what
        // this bill used to say: a product dropped by the edit still has to
        // be reconsidered, and so does a date it was moved away from.
        const current = await this.model.findById( id )
            .select( 'status shop date items totalAmount lessRebate specialPurpose roundOffToGovt tcs' )
            .lean();
        if ( !current ) {
            throw new CalmError( 'NOT_FOUND_ERROR', 'Purchase not found.' );
        }
        const payload = { ...data };
        assertNotFutureDate( payload.date );
        let gross = current.totalAmount || 0;
        if ( payload.items !== undefined ) {
            const totals = await this.normaliseItems(
                payload.items, current.shop, payload
            );
            payload.items = totals.items;
            payload.totalQty = totals.totalQty;
            payload.totalAmount = totals.totalAmount;
            gross = totals.totalAmount;
        }
        Object.assign( payload, resolveCharges( payload, current, gross ) );

        if ( current.status !== 'confirmed' ) {
            return super.update( id, payload );
        }

        // A confirmed purchase must keep moving stock: emptying its lines
        // would leave a stock record that accounts for nothing. Unconfirm it
        // instead, which withdraws the stock honestly.
        if ( payload.items !== undefined && !payload.items.length ) {
            throw new CalmError(
                'VALIDATION_ERROR',
                'A confirmed purchase cannot be left with no lines. '
                + 'Unconfirm it first.'
            );
        }

        const session = await mongoose.startSession();
        try {
            let out = null;
            await session.withTransaction( async () => {
                const saved = await this.model.findByIdAndUpdate(
                    id,
                    { ...payload },
                    {
                        'new': true,
                        'runValidators': true,
                        'context': 'query',
                        session
                    }
                );
                if ( !saved ) {
                    throw new CalmError(
                        'NOT_FOUND_ERROR', 'Purchase not found.'
                    );
                }
                const scope = stockEngine.footprint( current, saved );
                const onHand = await stockEngine.recalc( {
                    'shop': saved.shop, ...scope
                }, session );
                out = {
                    'data': this.parseObj( saved ),
                    'recalculated': onHand.size
                };
            } );
            return out;
        } finally {
            await session.endSession();
        }
    }

    /** Only drafts can be deleted; a confirmed purchase is a stock record. */
    async delete( id ) {
        const current = await this.model.findById( id ).select( 'status' ).lean();
        if ( current && current.status === 'confirmed' ) {
            throw new CalmError(
                'VALIDATION_ERROR',
                'This purchase is confirmed and can no longer be deleted. '
                + 'Unconfirm it first, which withdraws the stock it posted.'
            );
        }
        return super.delete( id );
    }

    /**
     * Confirm a draft, which is what puts its bottles on the shelf: the
     * purchase becomes confirmed and the stock for its products on its date is
     * worked out again.
     *
     * Stock is not incremented — it is derived. The confirmed purchases and
     * sales are the record, and each product's cached `inventory` is rewritten
     * from them, so a purchase can later be corrected or taken back to draft
     * and the figures still add up.
     *
     * The status is claimed FIRST, with a conditional update that only matches
     * a draft, so two clicks (or two tabs) cannot both post the same invoice —
     * the second finds nothing to claim. The whole thing runs in a
     * transaction: a posting that fails half way would leave stock no document
     * accounts for.
     * @param { string } id
     * @param { string } [userId]
     */
    async confirm( id, userId ) {
        const session = await mongoose.startSession();
        try {
            let out = null;
            await session.withTransaction( async () => {
                const claimed = await this.model.findOneAndUpdate(
                    { '_id': id, 'status': 'draft' },
                    {
                        '$set': {
                            'status': 'confirmed',
                            'confirmedAt': dayjs().toDate(),
                            'confirmedBy': userId
                        }
                    },
                    { 'new': true, session }
                );

                if ( !claimed ) {
                    // Either it does not exist, or it is already confirmed.
                    const exists = await this.model.findById( id )
                        .select( 'status' ).session( session ).lean();
                    if ( !exists ) {
                        throw new CalmError(
                            'NOT_FOUND_ERROR', 'Purchase not found.'
                        );
                    }
                    throw new CalmError(
                        'VALIDATION_ERROR', 'This purchase is already confirmed.'
                    );
                }

                if ( !claimed.items.length ) {
                    throw new CalmError(
                        'VALIDATION_ERROR',
                        'Add at least one product before confirming.'
                    );
                }

                const onHand = await stockEngine.recalc( {
                    'shop': claimed.shop,
                    ...stockEngine.footprint( null, claimed )
                }, session );

                out = {
                    'data': this.parseObj( claimed ),
                    'stocked': onHand.size,
                    'totalQty': claimed.totalQty
                };
            } );
            return out;
        } finally {
            await session.endSession();
        }
    }

    /**
     * Take a confirmed purchase back to draft, which withdraws the stock it
     * put on the shelf: once it is a draft the stock calculation stops
     * counting it, so its products are simply worked out again.
     *
     * This is the reversible path: a draft can then be edited freely or
     * deleted. Nothing here guards against the stock having been sold on
     * since — withdrawing a purchase whose bottles have left the shop will
     * leave that product negative, which is the stock figures telling the truth.
     * @param { string } id
     * @param { string } [userId]
     */
    async unconfirm( id, userId ) {
        const session = await mongoose.startSession();
        try {
            let out = null;
            await session.withTransaction( async () => {
                const claimed = await this.model.findOneAndUpdate(
                    { '_id': id, 'status': 'confirmed' },
                    {
                        '$set': { 'status': 'draft', 'updatedBy': userId },
                        '$unset': { 'confirmedAt': 1, 'confirmedBy': 1 }
                    },
                    { 'new': true, session }
                );
                if ( !claimed ) {
                    const exists = await this.model.findById( id )
                        .select( 'status' ).session( session ).lean();
                    if ( !exists ) {
                        throw new CalmError(
                            'NOT_FOUND_ERROR', 'Purchase not found.'
                        );
                    }
                    throw new CalmError(
                        'VALIDATION_ERROR', 'This purchase is not confirmed.'
                    );
                }
                const onHand = await stockEngine.recalc( {
                    'shop': claimed.shop,
                    ...stockEngine.footprint( null, claimed )
                }, session );
                out = {
                    'data': this.parseObj( claimed ),
                    'withdrawn': onHand.size
                };
            } );
            return out;
        } finally {
            await session.endSession();
        }
    }
}

module.exports = { PurchaseService };
