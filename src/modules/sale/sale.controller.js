'use strict';
const { CalmController } = require( '../../../system/core/CalmController' );
const { SaleService } = require( './sale.service' );
const { Sale } = require( './sale.model' );
const saleDTO = require( './sale.dto' );
const autoBind = require( 'auto-bind' ),
    saleService = new SaleService(
        new Sale().getInstance()
    );

class SaleController extends CalmController {

    constructor( service ) {
        super( service );
        this.dto = { ...this.dto, ...saleDTO };
        autoBind( this );
    }

    /**
     * PUT /sales/:id/confirm
     * Confirms a draft sale: each line's qty leaves its product's
     * stock. Refused rather than applied twice on a second call, and refused
     * outright if a line would oversell.
     */
    async confirm( req, res, next ) {
        try {
            const result = await this.service.confirm(
                req.params.id,
                req.user && req.user._id
            );
            res.sendCalmResponse( result.data, {
                'updated': true,
                'metaData': {
                    'confirmed': true,
                    'destocked': result.destocked,
                    'totalQty': result.totalQty
                }
            } );
        } catch ( e ) {
            next( e );
        }
    }

    /**
     * PUT /sales/:id/unconfirm
     * Takes a confirmed sale back to draft and puts its stock back.
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
                    'restocked': result.restocked
                }
            } );
        } catch ( e ) {
            next( e );
        }
    }
}

module.exports = new SaleController( saleService );
