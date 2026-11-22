'use strict';

class GetDTO {
    constructor( { ...props } ) {
        this._id = props._id;
        this.name = props.name;
        this.code = props.code;
        this.shop = props.shop;
        this.category = props.category;
        this.motherCategory = props.motherCategory;
        this.company = props.company;
        this.capacity = props.capacity;
        this.mrp = props.mrp;
        this.purchasePrice = props.purchasePrice;
        this.mainUnit = props.mainUnit;
        this.alternateUnit = props.alternateUnit;
        this.perAlternateUnitQty = props.perAlternateUnitQty;
        this.stockAlertQty = props.stockAlertQty;
        this.inventory = props.inventory;
        this.displayNumber = props.displayNumber;
        this.status = props.status;

        // Auto Generated Fields
        this.createdBy = props.createdBy;
        this.updatedBy = props.updatedBy;
        this.createdAt = props.createdAt;
        this.updatedAt = props.updatedAt;
        Object.freeze( this );
    }
}


class InsertDTO {
    constructor( { ...props } ) {
        this.name = props.name;
        this.code = props.code;
        this.shop = props.shop;
        this.category = props.category;
        this.motherCategory = props.motherCategory;
        this.company = props.company;
        this.capacity = props.capacity;
        this.mrp = props.mrp;
        this.purchasePrice = props.purchasePrice;
        this.mainUnit = props.mainUnit;
        this.alternateUnit = props.alternateUnit;
        this.perAlternateUnitQty = props.perAlternateUnitQty;
        this.stockAlertQty = props.stockAlertQty;
        // No inventory: a new product starts at zero. Stock arrives by
        // confirming a purchase, never by being typed on a form.
        this.displayNumber = props.displayNumber;
        this.status = props.status;
        // Auto Generated Fields
        this.createdBy = props.createdBy;
        Object.freeze( this );
    }
}

class UpdateDTO {
    constructor( { ...props } ) {
        this.name = props.name;
        this.code = props.code;
        this.shop = props.shop;
        this.category = props.category;
        this.motherCategory = props.motherCategory;
        this.company = props.company;
        this.capacity = props.capacity;
        this.mrp = props.mrp;
        this.purchasePrice = props.purchasePrice;
        this.mainUnit = props.mainUnit;
        this.alternateUnit = props.alternateUnit;
        this.perAlternateUnitQty = props.perAlternateUnitQty;
        this.stockAlertQty = props.stockAlertQty;
        // `inventory` is not updatable either: stock on hand is worked out
        // from the confirmed purchases and sales, never set by hand.
        this.displayNumber = props.displayNumber;
        this.status = props.status;
        // Auto Generated Fields
        this.updatedBy = props.updatedBy;
        // Delete Fields which are not present in data
        Object.keys( this ).forEach( key => {
            if ( this[ key ] === undefined ) {
                delete this[ key ];
            }
        } );
        Object.freeze( this );
    }
}

module.exports = { GetDTO, InsertDTO, UpdateDTO };
