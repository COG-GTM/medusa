import { loadDatabaseConfig } from "../load-module-database-config"

describe("loadDatabaseConfig", function () {
  afterEach(() => {
    delete process.env.DATABASE_URL
    delete process.env.MEDUSA_DATABASE_URL
    delete process.env.PRODUCT_DATABASE_URL
    delete process.env.MEDUSA_DATABASE_SSL_REJECT_UNAUTHORIZED
  })

  it("should return the local configuration using the environment variable respecting their precedence", function () {
    process.env.MEDUSA_DATABASE_URL = "postgres://localhost:5432/medusa"
    process.env.PRODUCT_DATABASE_URL = "postgres://localhost:5432/product"
    process.env.DATABASE_URL = "postgres://localhost:5432/share_db"

    let config = loadDatabaseConfig("product")

    expect(config).toEqual({
      clientUrl: process.env.PRODUCT_DATABASE_URL,
      driverOptions: {
        connection: {
          ssl: false,
        },
      },
      debug: false,
      schema: "",
    })

    delete process.env.PRODUCT_DATABASE_URL
    config = loadDatabaseConfig("product")

    expect(config).toEqual({
      clientUrl: process.env.MEDUSA_DATABASE_URL,
      driverOptions: {
        connection: {
          ssl: false,
        },
      },
      debug: false,
      schema: "",
    })

    delete process.env.MEDUSA_DATABASE_URL
    config = loadDatabaseConfig("product")

    expect(config).toEqual({
      clientUrl: process.env.DATABASE_URL,
      driverOptions: {
        connection: {
          ssl: false,
        },
      },
      debug: false,
      schema: "",
    })
  })

  it("should return the remote configuration using the environment variable", function () {
    process.env.DATABASE_URL = "postgres://https://test.com:5432/medusa"
    let config = loadDatabaseConfig("product")

    expect(config).toEqual({
      clientUrl: process.env.DATABASE_URL,
      driverOptions: {
        connection: {
          ssl: {
            rejectUnauthorized: true,
          },
        },
      },
      debug: false,
      schema: "",
    })

    delete process.env.DATABASE_URL
    process.env.PRODUCT_DATABASE_URL = "postgres://https://test.com:5432/medusa"
    config = loadDatabaseConfig("product")

    expect(config).toEqual({
      clientUrl: process.env.PRODUCT_DATABASE_URL,
      driverOptions: {
        connection: {
          ssl: {
            rejectUnauthorized: true,
          },
        },
      },
      debug: false,
      schema: "",
    })
  })

  it("should return the local configuration using the options", function () {
    process.env.DATABASE_URL = "postgres://localhost:5432/medusa"
    const options = {
      database: {
        clientUrl: "postgres://localhost:5432/medusa-test",
      },
    }

    let config = loadDatabaseConfig("product", options)

    expect(config).toEqual({
      clientUrl: options.database.clientUrl,
      driverOptions: {
        connection: {
          ssl: false,
        },
      },
      debug: false,
      schema: "",
    })
  })

  it("should return the local configuration using the options", function () {
    process.env.DATABASE_URL = "postgres://localhost:5432/medusa"
    const options = {
      database: {
        clientUrl: "postgres://127.0.0.1:5432/medusa-test",
      },
    }

    let config = loadDatabaseConfig("product", options)

    expect(config).toEqual({
      clientUrl: options.database.clientUrl,
      driverOptions: {
        connection: {
          ssl: false,
        },
      },
      debug: false,
      schema: "",
    })
  })

  it("should return the remote configuration using the options", function () {
    process.env.DATABASE_URL = "postgres://localhost:5432/medusa"
    const options = {
      database: {
        clientUrl: "postgres://https://test.com:5432/medusa-test",
      },
    }

    let config = loadDatabaseConfig("product", options)

    expect(config).toEqual({
      clientUrl: options.database.clientUrl,
      driverOptions: {
        connection: {
          ssl: {
            rejectUnauthorized: true,
          },
        },
      },
      debug: false,
      schema: "",
    })
  })

  it("should skip certificate verification when the client url opts out", function () {
    const options = {
      database: {
        clientUrl:
          "postgres://https://test.com:5432/medusa-test?sslmode=no-verify",
      },
    }

    const config = loadDatabaseConfig("product", options)

    expect(config.driverOptions).toEqual({
      connection: {
        ssl: {
          rejectUnauthorized: false,
        },
      },
    })
  })

  it("should keep certificate verification when no-verify only appears outside the query parameters", function () {
    const options = {
      database: {
        clientUrl:
          "postgres://user:sslmode=no-verify@test.com:5432/sslmode=no-verify",
      },
    }

    const config = loadDatabaseConfig("product", options)

    expect(config.driverOptions).toEqual({
      connection: {
        ssl: {
          rejectUnauthorized: true,
        },
      },
    })
  })

  it("should skip certificate verification when the environment opts out", function () {
    process.env.MEDUSA_DATABASE_SSL_REJECT_UNAUTHORIZED = "false"
    const options = {
      database: {
        clientUrl: "postgres://https://test.com:5432/medusa-test",
      },
    }

    const config = loadDatabaseConfig("product", options)

    expect(config.driverOptions).toEqual({
      connection: {
        ssl: {
          rejectUnauthorized: false,
        },
      },
    })
  })

  it("should return the local configuration using the client url ssl_mode=disable", function () {
    process.env.DATABASE_URL = "postgres://localhost:5432/medusa"
    const options = {
      database: {
        clientUrl:
          "postgres://https://test.com:5432/medusa-test?ssl_mode=disable",
      },
    }

    let config = loadDatabaseConfig("product", options)

    expect(config).toEqual({
      clientUrl: "postgres://https://test.com:5432/medusa-test",
      driverOptions: {
        connection: {
          ssl: false,
        },
      },
      debug: false,
      schema: "",
    })
  })

  it("should return the local configuration using the client url sslmode=disable", function () {
    process.env.DATABASE_URL = "postgres://localhost:5432/medusa"
    const options = {
      database: {
        clientUrl:
          "postgres://https://test.com:5432/medusa-test?sslmode=disable",
      },
    }

    let config = loadDatabaseConfig("product", options)

    expect(config).toEqual({
      clientUrl: "postgres://https://test.com:5432/medusa-test?sslmode=disable",
      driverOptions: {
        connection: {
          ssl: false,
        },
      },
      debug: false,
      schema: "",
    })
  })

  it("should return the remote configuration using the client url ssl_mode=false", function () {
    process.env.DATABASE_URL = "postgres://localhost:5432/medusa"
    const options = {
      database: {
        clientUrl:
          "postgres://https://test.com:5432/medusa-test?ssl_mode=false",
      },
    }

    let config = loadDatabaseConfig("product", options)

    expect(config).toEqual({
      clientUrl: "postgres://https://test.com:5432/medusa-test",
      driverOptions: {
        connection: {
          ssl: false,
        },
      },
      debug: false,
      schema: "",
    })
  })

  it("should throw if no clientUrl is provided", function () {
    let error
    try {
      loadDatabaseConfig("product")
    } catch (e) {
      error = e
    }

    expect(error.message).toEqual(
      "No database clientUrl provided. Please provide the clientUrl through the [MODULE]_DATABASE_URL, MEDUSA_DATABASE_URL or DATABASE_URL environment variable or the options object in the initialize function."
    )
  })
})
