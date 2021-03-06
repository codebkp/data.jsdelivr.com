const Joi = require('joi');

class BaseModel {
	static get table () {}
	static get schema () {}
	static get unique () {}

	static get columns () {
		return Object.keys(this.schema);
	}

	static get columnsPrefixed () {
		return this.columns.map(column => `${this.table}.${column}`);
	}

	get unique () {
		return _.pickBy(_.pick(this, this.constructor.unique));
	}

	constructor () {}

	/**
	 * Gets the first object matching the criteria.
	 *
	 * @param {Object|Function|number} criteria
	 * @returns {Promise<*>}
	 */
	static async find (criteria) {
		let where;

		if (_.isObject(criteria) || typeof criteria === 'function') {
			where = criteria;
		} else if (typeof criteria === 'number') {
			where = { id: criteria };
		} else {
			return null;
		}

		return db(this.table).where(where).first().then((data) => {
			return data ? new this(data).dbOut() : null;
		});
	}

	/**
	 * Gets all objects matching the criteria.
	 *
	 * @param {Object|Function} [criteria]
	 * @param {number} [limit]
	 * @param {number} [offset]
	 * @returns {Promise<*>}
	 */
	static async findAll (criteria = {}, limit, offset) {
		let sql = db(this.table).where(criteria);

		if (typeof limit === 'number') {
			sql.limit(limit);
		}

		if (typeof offset === 'number') {
			sql.offset(offset);
		}

		return Promise.map(sql.select(), data => new this(data).dbOut());
	}

	dbIn () {
		return _.pick(this, Object.keys(this.constructor.schema));
	}

	async dbOut () {
		return this;
	}

	/**
	 * @returns {Promise<number>}
	 */
	async delete () {
		return db(this.constructor.table).where(this.unique).delete();
	}

	/**
	 * @returns {Promise<this>}
	 */
	async insert () {
		if ('updatedAt' in this) {
			this.updatedAt = new Date();
		}

		await this.validate();

		return db(this.constructor.table).insert(this.dbIn()).spread((id) => {
			this.id = id;
			return this;
		});
	}

	async insertOrLoad () {
		try {
			await this.insert();
		} catch (e) {
			if (e.sqlState !== '23000') {
				throw e;
			}

			let found = await this.constructor.find(this.unique);

			if (!found) {
				throw new Error(`Error 23000 thrown but then not found: ${e.message}`);
			}

			Object.assign(this, found);
			return false;
		}

		return true;
	}

	async isValid () {
		try {
			await this.validate();
		} catch (e) {
			return false;
		}

		return true;
	}

	/**
	 * @returns {Promise<number>}
	 */
	async update () {
		if ('updatedAt' in this) {
			this.updatedAt = new Date();
		}

		await this.validate();

		return db(this.constructor.table).where(this.unique).update(this.dbIn());
	}

	async validate () {
		let result = Joi.validate(this.dbIn(), this.constructor.schema, { abortEarly: false });

		if (result.error) {
			throw result.error;
		}
	}

	toSqlInsert (onDuplicate = `id = LAST_INSERT_ID(id); SET @update_id_${this.constructor.table} = LAST_INSERT_ID()`) {
		return db(this.constructor.table).insert(this.dbIn()).toString().replace(/'(@update_id_\w+)'/g, '$1') + ' ON DUPLICATE KEY UPDATE ' + onDuplicate + ';';
	}
}

module.exports = BaseModel;

module.exports.ProxyHandler = {
	set (target, property, value) {
		if (!(property in target.constructor.schema)) {
			target[property] = value;
			return true;
		}

		let setter = `set${property[0].toUpperCase()}${property.substr(1)}`;

		if (setter in this) {
			value = this[setter](target, value);
		}

		Joi.assert(value, target.constructor.schema[property], `${property}:`);
		target[property] = value;
		return true;
	},
};
