'use strict';
const { CalmController } = require( '../../../system/core/CalmController' );
const { PurchaseService } = require( './purchase.service' );
const { Purchase } = require( './purchase.model' );
const purchaseDTO = require( './purchase.dto' );
const autoBind = require( 'auto-bind' ),
    purchaseService = new PurchaseService(
        new Purchase().getInstance()
    );

class PurchaseController extends CalmController {

    constructor( service ) {
        super( service );
        this.dto = { ...this.dto, ...purchaseDTO };
        autoBind( this );
    }

    /**
     * PUT /purchases/:id/confirm
     * Posts a draft purchase to stock: each line's qty is added to its
     * product's inventory. Idempotent by rejection — a second call on an
     * already-confirmed purchase is refused rather than applied twice.
     */
    async confirm( req, res, next ) {
        try {
            const result = await this.service.confirm(
                req.params.id,
                req.user && req.user._id
            );
            // The envelope passes through only the keys it knows, so what
            // the posting did goes in metaData rather than being dropped.
            res.sendCalmResponse( result.data, {
                'updated': true,
                'metaData': {
                    'confirmed': true,
                    'stocked': result.stocked,
                    'totalQty': result.totalQty
                }
            } );
        } catch ( e ) {
            next( e );
        }
    }

    /**
     * PUT /purchases/:id/unconfirm
     * Takes a confirmed purchase back to draft and withdraws the stock it
     * posted, so it can be corrected or removed.
     */
    async unconfirm( req, res, next ) {
        try {
            const result = await this.service.unconfirm(
                req.params.id,
                req.user && req.user._id
            );
            res.sendCalmResponse( result.data, {
                'updated': true,
                'metaData': {
                    'confirmed': false,
                    'withdrawn': result.withdrawn
                }
            } );
        } catch ( e ) {
            next( e );
        }
    }
}

module.exports = new PurchaseController( purchaseService );
