'use strict';

/**
 * A daily snapshot row as it goes out. The stock endpoints shape their own
 * responses; this is for the generic CalmController reads.
 */
class GetDTO {
    constructor( { ...props } ) {
        this._id = props._id;
        this.shop = props.shop;
        this.product = props.product;
        this.date = props.date;
        this.inQty = props.inQty;
        this.outQty = props.outQty;
        this.inAmount = props.inAmount;
        this.outAmount = props.outAmount;
        this.createdAt = props.createdAt;
        this.updatedAt = props.updatedAt;
        Object.freeze( this );
    }
}

// Snapshots are worked out, never posted: stock moves by confirming a
// purchase or a sale. The write DTOs exist only so the base controller has
// something to refuse with.
class InsertDTO {
    constructor() {
        Object.freeze( this );
    }
}

class UpdateDTO {
    constructor() {
        Object.freeze( this );
    }
}

module.exports = { GetDTO, InsertDTO, UpdateDTO };
