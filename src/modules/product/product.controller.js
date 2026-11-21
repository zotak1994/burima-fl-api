'use strict';
const { CalmController } = require( '../../../system/core/CalmController' );
const { CalmError } = require( '../../../system/core/CalmError' );
const { ProductService } = require( './product.service' );
const { Product } = require( './product.model' );
const productDTO = require( './product.dto' );
const autoBind = require( 'auto-bind' ),
    productService = new ProductService(
        new Product().getInstance()
    );

/** Filesystem-safe local date for download filenames, e.g. 2026-11-14. */
function fileStamp() {
    const d = new Date();
    const p = ( n ) => String( n ).padStart( 2, '0' );
    return `${ d.getFullYear() }-${ p( d.getMonth() + 1 ) }-${ p( d.getDate() ) }`;
}

/**
 * Turn a shop name into a filename-safe fragment, e.g. "Main Road Outlet" ->
 * "Main-Road-Outlet". Returns '' for a blank name so the caller can leave the
 * filename unlabelled.
 */
function fileSlug( name ) {
    if ( !name ) return '';
    return String( name )
        // Decompose, then drop the combining marks: without this second step
        // an accent becomes a separator and "Café" slugs to "Cafe-".
        .normalize( 'NFKD' )
        .replace( /[̀-ͯ]/g, '' )
        .replace( /[^a-zA-Z0-9]+/g, '-' )
        .slice( 0, 40 )
        // Trim after slicing too, so a cut mid-word leaves no trailing dash.
        .replace( /^-+|-+$/g, '' );
}

class ProductController extends CalmController {

    constructor( service ) {
        super( service );
        this.dto = { ...this.dto, ...productDTO };
        autoBind( this );
    }

    /**
     * PUT /products/reorder
     * body: { items: [{ id, displayNumber }] } (or a bare array)
     * Persists the admin-arranged product ordering.
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

    /**
     * GET /products/template?shop=<id>
     * Streams the .xlsx bulk-import template built by the service. With a shop
     * its name is pre-filled in the sheet and added to the filename.
     */
    async downloadTemplate( req, res, next ) {
        try {
            const wb = await this.service.buildTemplateWorkbook( req.query.shop );
            const slug = fileSlug( await this.service.shopLabel( req.query.shop ) );
            res.setHeader(
                'Content-Type',
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            );
            res.setHeader(
                'Content-Disposition',
                `attachment; filename="product-template${ slug ? `_${ slug }` : '' }_${ fileStamp() }.xlsx"`
            );
            await wb.xlsx.write( res );
            res.end();
        } catch ( e ) {
            next( e );
        }
    }

    /**
     * GET /products/export?shop=<id>
     * Streams an .xlsx export of the shop's products (same layout as the
     * template). Without ?shop it exports every shop.
     */
    async downloadItems( req, res, next ) {
        try {
            const wb = await this.service.buildItemsWorkbook( req.query.shop );
            const slug = fileSlug( await this.service.shopLabel( req.query.shop ) );
            res.setHeader(
                'Content-Type',
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            );
            res.setHeader(
                'Content-Disposition',
                `attachment; filename="products${ slug ? `_${ slug }` : '' }_${ fileStamp() }.xlsx"`
            );
            await wb.xlsx.write( res );
            res.end();
        } catch ( e ) {
            next( e );
        }
    }

    /**
     * POST /products/upload?shop=<id>  (multipart, field "file")
     * Hands the uploaded workbook to the service for parsing and bulk insert.
     * `shop` is the outlet the upload was made from, used for rows whose shop
     * column is blank.
     */
    async uploadTemplate( req, res, next ) {
        try {
            if ( !req.file ) {
                throw new CalmError( 'VALIDATION_ERROR', 'Template file is required.' );
            }
            const result = await this.service.importFromTemplate(
                req.file.buffer,
                req.user && req.user._id,
                req.query.shop
            );
            res.sendCalmResponse( result, {
                'imported': true,
                'created': result.created,
                'failed': result.failed
            } );
        } catch ( e ) {
            next( e );
        }
    }

}

module.exports = new ProductController( productService );
