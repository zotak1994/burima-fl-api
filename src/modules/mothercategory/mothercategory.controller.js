'use strict';
const { CalmController } = require( '../../../system/core/CalmController' );
const { MotherCategoryService } = require( './mothercategory.service' );
const { MotherCategory } = require( './mothercategory.model' );
const mothercategoryDTO = require( './mothercategory.dto' );
const autoBind = require( 'auto-bind' ),
    mothercategoryService = new MotherCategoryService(
        new MotherCategory().getInstance()
    );

class MotherCategoryController extends CalmController {

    constructor( service ) {
        super( service );
        this.dto = { ...this.dto, ...mothercategoryDTO };
        autoBind( this );
    }

    /**
     * PUT /mother-categories/reorder
     * body: { items: [{ id, displayNumber }] } (or a bare array)
     * Persists the admin-arranged ordering.
     */
    async reorder( req, res, next ) {
        try {
            const items = Array.isArray( req.body ) ? req.body : req.body.items;
            const response = await this.service.reorder( items );
            res.sendCalmResponse( null, { 'updated': response.data.updated } );
        } catch ( e ) {
            next( e );
        }
    }

}

module.exports = new MotherCategoryController( mothercategoryService );
