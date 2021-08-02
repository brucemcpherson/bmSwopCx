class _SwopCx {

  /**
   * @param {function} fetcher the fetcher function from apps script- passed over to keep lib dependency free
   * @param {string} apiKey the fixer.io apiKey
   * @param {string} [defaultBase] the default base currency - this doesn't with the Free version of fixer.io so don't specify it
   */
  constructor({ fetcher, apiKey, defaultBase = "EUR" , freeTier = true}) {
    this.apiKey = apiKey
    this.fetcher = fetcher
    this.defaultBase = defaultBase
    this.freeTier = freeTier
    this.endpoint = 'https://swop.cx/graphql'
    if (!this.apiKey) throw new Error('apiKey property not provided - goto fixer.io to get one and pass to constructor')
    if (!this.fetcher) throw new Error('fetcher property not provided- pass urlfetchapp.fetch to constructor')
  }


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


  /**
   * private
   * @param {string} url the complete url
   * @returns {object} the api response parsed
   */
  _fetch(url, options) {
    const response = this.fetcher(url, options)
    return JSON.parse(response.getContentText())
  }

  get _fields() {
    return `
      date
      baseCurrency
      quoteCurrency
      quote
    `
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

  /**
   * return the latest data for the selected currencies
   * @param {object} params to add to the access key url params - should be {symbols: 'usd,gbp,...etc'}
   * @returns {object} the api response parsed
   */
  latest(params) {

    const response = this._fetch(this.endpoint, this._makeOptions(
      `query  {
         latest ( ${this._qc(params)} ${this._bc(params)}){
          ${this._fields}
        }
      }`
    ))
    const result = response && response.data && response.data.latest
    if (!result) throw new Error(JSON.stringify(response))
    return result
  }

  onThisDay(params) {
    const base = params.base || this.defaultBase
    if (!params.start_date) throw new Error(`onThisDay needs a start_date parameter in this format YYYY-MM-DD`)
    const response = this._fetch(this.endpoint, this._makeOptions(
      `query {
          historical (date: "${params.start_date}", ${this._qc(params)} ${this._bc(params)} ) {
            ${this._fields}
          }
        }
      `
    ))
    const result = response && response.data && response.data.historical && response.data.historical.map(f=>({
      ...f,
      historical: true
    }))
    if (!result) throw new Error(JSON.stringify(response))
    return result
  }

  currencies(params) {

    const response = this._fetch(this.endpoint, this._makeOptions(
      `query  {
         currencies (${this._cc(params)}){
          code
          name
          numericCode
          decimalDigits
          active
        }
      }`
    ))
    const result = response && response.data && response.data.currencies
    if (!result) throw new Error(JSON.stringify(response))
    return result
  }


  // not available on free tier
  timeSeries(params) {

    if (!params.start_date) throw new Error(`timeseries needs a start_date parameter in this format YYYY-MM-DD`)
    if (!params.end_date) throw new Error(`timeseries needs an end_date parameter in this format YYYY-MM-DD`)
    const response = this._fetch(this.endpoint, this._makeOptions(
      `query {
          timeSeries (dateFrom: "${params.start_date}", dateTo: "${params.end_date}",   ${this._qc(params)} ${this._bc(params)}) {
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
   * @returns {object} an emulation of a return from fixer.convert
   */
  hackConvert(swopCxResult, { from, to, amount = 1 }) {
    // check that the result is a valid one
    if (!Array.isArray(swopCxResult)) throw new Error('input swopCxResult should be an array')
    // and that it contains both from and to rates

    const rateFrom = swopCxResult.find(f=>from === f.quoteCurrency)
    const rateTo = swopCxResult.find(f=>to === f.quoteCurrency)
    if (!rateFrom) throw new Error('from currency not found in swopCxResult')
    if (!rateTo) throw new Error('to currency not found in swopCxResult')
    if(rateFrom.baseCurrency !== rateTo.baseCurrency) throw new Error('base currencies mst match for conversion to work')
    const rate = rateTo.quote / rateFrom.quote
    const result = rate * amount
    const {historical, date} = rateFrom
 
    return {
      rate,
      historical: historical || false,
      date,
      result
    }

  }

}

var Fx = (options) => new _SwopCx(options)

