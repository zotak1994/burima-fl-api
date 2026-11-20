'use strict';
const mongoose = require( 'mongoose' );
const { Schema } = require( 'mongoose' );
const uniqueValidator = require( 'mongoose-unique-validator' );
const { toAmount } = require( '../../utils' );

class Product {

    initSchema() {
        const schema = new Schema( {
            'name': {
                'type': String,
                'required': true,
                'trim': true
            },
            'shop': {
                // The outlet this product belongs to. Every product is owned by
                // exactly one shop; sell and purchase orders will hang off the
                // same ref.
                'type': Schema.Types.ObjectId,
                'ref': 'shop',
                'required': true,
                'index': true
            },
            'category': {
                'type': Schema.Types.ObjectId,
                'ref': 'category',
                'required': true
            },
            // Both lookups are optional so existing rows and partial bulk
            // imports stay valid; the admin form still asks for company.
            'motherCategory': {
                'type': Schema.Types.ObjectId,
                'ref': 'mothercategory',
                'index': true
            },
            'company': {
                'type': Schema.Types.ObjectId,
                'ref': 'company',
                'index': true
            },
            'capacity': {
                // Bottle size. Optional, so partial imports stay valid.
                'type': Schema.Types.ObjectId,
                'ref': 'capacity',
                'index': true
            },
            'mrp': {
                // Maximum retail price.
                'type': Number,
                'required': true,
                'min': 0,
                'set': toAmount
            },
            'purchasePrice': {
                // What the product costs to buy in.
                'type': Number,
                'required': true,
                'min': 0,
                'set': toAmount
            },
            'mainUnit': {
                // The unit the product is stocked and priced in.
                'type': String,
                'enum': [ 'BOTTLE' ],
                'default': 'BOTTLE',
                'uppercase': true,
                'trim': true
            },
            'alternateUnit': {
                // The larger pack the product ships in.
                'type': String,
                'enum': [ 'CASE' ],
                'default': 'CASE',
                'uppercase': true,
                'trim': true
            },
            'perAlternateUnitQty': {
                // How many main units make up one alternate unit.
                'type': Number,
                'required': true,
                'min': 1,
                'default': 1
            },
            'stockAlertQty': {
                // Stock at or below this level counts as low.
                'type': Number,
                'required': true,
                'min': 0,
                'default': 0
            },
            'inventory': {
                // Stock on hand. Owned by the server: the admin product form
                // reads it but never submits it.
                'type': Number,
                'required': true,
                'min': 0,
                'default': 0
            },
            'displayNumber': {
                'type': Number,
                'default': 0,
                'index': true
            },
            'status': {
                'type': Boolean,
                'default': true
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
            mongoose.model( 'product', schema );
        } catch ( e ) {

        }

    }

    getInstance() {
        this.initSchema();
        return mongoose.model( 'product' );
    }
}

module.exports = { Product };
