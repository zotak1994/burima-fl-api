'use strict';
const { CalmController } = require( '../../../system/core/CalmController' );
const { CategoryService } = require( './category.service' );
const { Category } = require( './category.model' );
const categoryDTO = require( './category.dto' );
const autoBind = require( 'auto-bind' ),
    categoryService = new CategoryService(
        new Category().getInstance()
    );

class CategoryController extends CalmController {

    constructor( service ) {
        super( service );
        this.dto = { ...this.dto, ...categoryDTO };
        autoBind( this );
    }

    /**
     * PUT /categories/reorder
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

module.exports = new CategoryController( categoryService );
