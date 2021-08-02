class _SwopCx {

  /**
   * @param {options}
   * @param {function} options.fetcher the fetcher function from apps script- passed over to keep lib dependency free
   * @param {string} options.apiKey the apiKey
   * @param {string} [options.defaultBase ="EUR"] the default base currency - this doesn't work with the free version
   * @param {boolean} [options.freeTier = true] whether the apiKey is for the limited free tier
   * @param {cache} [options.cache = null] the apps script cache service to use
   * @param {number} [options.cacheSeconds = 3600] the lifetime for cache
   */
  constructor({ fetcher, apiKey, defaultBase = "EUR", freeTier = true, cache = null, cacheSeconds = 60 * 60 }) {
    this.apiKey = apiKey
    this.fetcher = fetcher
    this.defaultBase = defaultBase
    this.freeTier = freeTier
    this.endpoint = 'https://swop.cx/graphql'
    this.cacheSeconds = cacheSeconds
    this.cache = cache
    if (!this.apiKey) throw new Error('apiKey property not provided - goto fixer.io to get one and pass to constructor')
    if (!this.fetcher) throw new Error('fetcher property not provided- pass urlfetchapp.fetch to constructor')
  }


  // make a sha1 digest
  _digest(...args) {
    // conver args to an array and digest them
    const t = args.map(d => {
      return (Object(d) === d) ? JSON.stringify(d) : (typeof d === typeof undefined ? 'undefined' : d.toString());
    }).join("-")
    const s = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_1, t, Utilities.Charset.UTF_8)
    return Utilities.base64EncodeWebSafe(s)
  };

  _makeOptions(query) {
    return {
      method: 'POST',
      payload: JSON.stringify({ query }),
      contentType: 'application/json',
      headers: {
        Authorization: `ApiKey ${this.apiKey}`
      }
    }
  }

  _cache(params) {
    return this.cacheSeconds && !params.noCache && this.cache
  }

  _cachePut(digest, item) {
    // always puts to cache irrespective of the params.noCache setting
    return (this.cache && this.cacheSeconds && this.cache.put(digest, JSON.stringify(item), this.cacheSeconds)) || null
  }

  _cacheGet(cache, digest) {
    const item = cache && cache.get(digest)
    return (item && JSON.parse(item)) || null
  }

  _fetch(url, options, params) {

    const cache = this._cache(params)
    const digest = this._digest(url, options)

    const makeResult = (cached) => {
      if (!cached) {
        const response = this.fetcher(url, options)
        const text = response.getContentText()
        const data = text ? JSON.parse(text) : null
        cached = {
          digest,
          data,
          timestamp: new Date().getTime(),
          fromCache: false
        }
        this._cachePut(digest, cached)
        return cached
      } else {
        return {
          ...cached,
          fromCache: true
        }
      }
    }
    return makeResult(this._cacheGet(cache, digest))
  }


  get _fields() {
    return `
      date
      baseCurrency
      quoteCurrency
      quote
    `
  }

  get _meta() {
    return `meta {
        sourceShortNames
        sourceNames
        sourceIds
        sources {
          id
          shortName
          name
        }
        rateType
        calculated
        calculationShortDescription
        calculationDescription
        calculation {
          pathRate
          weight
          sourceRates {
            sourceId
            date
            baseCurrency
            quoteCurrency
            quote
            flipped
            fetched
            source {
              id
              shortName
              name
            }
          }
        }
    }`
  }

  get _seriesFields() {
    return `
      baseCurrency
      quoteCurrency
        quotes {
          date
          quote
        }
    `
  }

  _qc(params) {
    return `quoteCurrencies: ${JSON.stringify(params.symbols.split(","))}`
  }

  _cc(params) {
    return `currencyCodes: ${JSON.stringify(params.symbols.split(","))}`
  }

  _bc(params) {
    return this.freeTier ? '' : `, baseCurrency: "${params.base || this.defaultBase}"`
  }

  _resultPack(response, property) {
    // if we have cachemeta enabled, the result will be a little more complicated
    const data = response && response.data && response.data.data && response.data.data[property]
    return {
      data,
      digest: response && response.digest,
      timestamp: response && response.timestamp,
      error: !data && response,
      fromCache: response && response.fromCache
    }
  }
  /**
   * @param {options}
   * @param {function} options.symbols the comma separated list of currencies to consider
   * @param {string} [options.base ="EUR"] the default base currency - this doesn't work with the free version
   * @param {boolean} [options.noCache = false] whether to skip caching (if its enabled in the first place)
   * @param {boolean} [options.meta = false] whether to include the metadata about the rate
   */
  latest(params) {

    return this._resultPack(this._fetch(this.endpoint, this._makeOptions(
      `query  {
         latest ( ${this._qc(params)} ${this._bc(params)}){
          ${this._fields}
          ${params.meta ? this._meta : ''}
        }
      }`
    ), params), 'latest')

  }

  /** 
   * @param {options}
   * @param {function} options.symbols the comma separated list of currencies to consider
   * @param {string} [options.base ="EUR"] the default base currency - this doesn't work with the free version
   * @param {boolean} [options.noCache = false] whether to skip caching (if its enabled in the first place)
   * @param {boolean} [options.meta = false] whether to include the metadata about the rate
   * @param {boolean} [options.startDate = false] whether to include the metadata about the rate
   */
  onThisDay(params) {

    if (!params.startDate) throw new Error(`onThisDay needs a startDate parameter in this format YYYY-MM-DD`)
    const result = this._resultPack(this._fetch(this.endpoint, this._makeOptions(
      `query {
          historical (date: "${params.startDate}", ${this._qc(params)} ${this._bc(params)} ) {
            ${this._fields}
            ${params.meta ? this._meta : ''}
          }
        }
      `
    ), params), 'historical')

    result.data.forEach(f => f.historical = true)
    return result

  }

  /** 
   * @param {options}
   * @param {function} options.symbols the comma separated list of currencies to consider
   * @param {boolean} [options.noCache = false] whether to skip caching (if its enabled in the first place)
   */
  currencies(params) {

    return this._resultPack(this._fetch(this.endpoint, this._makeOptions(
      `query  {
         currencies (${this._cc(params)}){
          code
          name
          numericCode
          decimalDigits
          active
        }
      }`
    ), params), 'currencies')

  }


  // not available on free tier
  // not yet implemented
  timeSeries(params) {

    if (!params.startDate) throw new Error(`timeseries needs a startDate parameter in this format YYYY-MM-DD`)
    if (!params.end_date) throw new Error(`timeseries needs an end_date parameter in this format YYYY-MM-DD`)
    const response = this._fetch(this.endpoint, this._makeOptions(
      `query {
          timeSeries (dateFrom: "${params.startDate}", dateTo: "${params.end_date}",   ${this._qc(params)} ${this._bc(params)}) {
            ${this._seriesFields}
          }
        }
      `
    ))
    const result = response && response.data && response.data.timeSeries
    if (!result) throw new Error(JSON.stringify(response))
    return result

  }
  /**
   {date: '2016-06-01',
    baseCurrency: 'EUR',
    quoteCurrency: 'AUD',
    quote: 1.537212 }
   */

  /**
   * do a conversion without using the api as its not available in the free tier
   * @param {object} swopCxResult an api response parsed as recevied by onThisDay() or latest()
   * @param {object} options
   * @param {string} options.from the from currency
   * @param {string} options.to the to currency
   * @param {number} [options.amount=1] the amount to convert
   * @returns {object} result
   */
  hackConvert(swopCxResult, { from, to, amount = 1 }) {
    // check that the result is a valid one
    if (!Array.isArray(swopCxResult)) throw new Error('input swopCxResult should be an array')
    // and that it contains both from and to rates

    const rateFrom = swopCxResult.find(f => from === f.quoteCurrency)
    const rateTo = swopCxResult.find(f => to === f.quoteCurrency)
    if (!rateFrom) throw new Error('from currency not found in swopCxResult')
    if (!rateTo) throw new Error('to currency not found in swopCxResult')
    if (rateFrom.baseCurrency !== rateTo.baseCurrency) throw new Error('base currencies mst match for conversion to work')
    const rate = rateTo.quote / rateFrom.quote
    const result = rate * amount
    const { historical, date } = rateFrom

    return {
      rate,
      historical: historical || false,
      date,
      result,
      to,
      from,
      amount
    }

  }

}

var Fx = (options) => new _SwopCx(options)

