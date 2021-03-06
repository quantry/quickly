import {BaseFile} from './basefile'
import {babelConfig} from './bundle'
import * as templates from './templates'
import * as babel from 'babel-core'

export class JSFile extends BaseFile {
    header = templates.header
    postHeader = templates.postHeader
    footer = ''
    globals = []

    loadFromCache(cache) {
        super.loadFromCache(cache)
        this.globals = cache['globals']
    }

    get cache() {
        return Object.assign({}, super.cache, {
            'globals': this.globals
        })
    }

    get importedGlobals() {
        const globals = {}

        for (const qualifier of Object.keys(this.dependencies)) {
            const dependency = this.dependencies[qualifier]

            if (Array.isArray(dependency.globals)) {
                for (const name of dependency.globals) {
                    globals[name] = qualifier
                }
            } else {
                for (const [name, typeName] of Object.entries(dependency.globals)) {
                    globals[name] = `${qualifier}.${typeName}`
                }
            }
        }

        return globals
    }

    get exportedGlobals() {
        const globals = Object.keys(this.importedGlobals).concat(this.globals)

        return globals
    }

    transform() {
        if (this.useBabel) {
            this.text = babel.transform(this.text, babelConfig).code
        }

        this.postHeader = this.postHeader.replace('FILENAME', this.basename)

        const bundle = this.bundle ? this.bundle.parentBundle || this.bundle : null

        const exports = bundle && bundle.config && bundle.config.exports

        if (this.usePolyfills && (!exports || !exports['quickly-polyfills'])) {
            this.injectRequire('quickly-polyfills')
        }

        this.transformRequires()
        this.transformExports()
        this.findGlobals()
        this.exportGlobals()
        this.importGlobals()
        this.exposeExports()

        this.text = this.text.trim()
        this.header = this.header.trim()
        this.postHeader = this.postHeader.trim()
        this.footer = this.footer.trim()

        if (this.postHeader)
            this.text = this.postHeader + '\n\n' + this.text
        if (this.header)
            this.text = this.header + '\n\n' + this.text
        if (this.footer)
            this.text += '\n\n' + this.footer

        this.text += '\n'
    }

    transformRequires() {
        this.text = this.text.replace(templates.requireAs, (...args) => {
            return this.replaceRequire(...args)
        })

        this.text = this.text.replace(templates.requireSideEffects, (match, $1, ...args) => {
            this.replaceRequire(match, $1, null, ...args)
            return ''
        })

        this.text = this.text.replace(templates.require, (match, $1, ...args) => {
            return this.replaceRequire(match, $1, null, ...args)
        })

        while (this.text.includes('\n\n\n'))
            this.text = this.text.replace('\n\n\n', '\n\n')
    }

    transformExports() {
        this.text = this.text.replace(templates.exportImport, 'var $1 = exports.$1 = $2.$1;')
        this.text = this.text.replace(templates.exportDefaultImport, 'var $1 = exports.$1 = $2.default;')
    }

    findGlobals() {
        const regex = /global\.([\w\d_]+)\s+=/g
        let match = null

        this.globals = []

        while ((match = regex.exec(this.text)) !== null) {
            const name = match[1]

            if (!this.globals.includes(name))
                this.globals.push(name)
        }
    }

    exposeExports() {
        const regex = /exports\.([\w\d_]+)\s+=/g
        let match = null

        const exports = []

        while ((match = regex.exec(this.text)) !== null) {
            const name = match[1]

            if (!exports.includes(name))
                exports.push(name)
        }

        for (const name of exports) {
            this.footer += `var ${name} = exports.${name};\n`
        }
    }

    exportGlobals() {
        for (const name of this.globals) {
            this.footer += `var ${name} = global.${name};\n`
        }
    }

    importGlobals() {
        this.postHeader += '\n'

        for (const name of Object.keys(this.importedGlobals)) {
            const qualifier = this.importedGlobals[name]

            this.postHeader += `var ${name} = global.${name} = ${qualifier}.global.${name};\n`
        }
    }

    injectRequire(importPath) {
        const dependency = this.require(importPath)
        const qualifier = dependency.qualifier()

        this.header += dependency.importStatement() + '\n'
        this.dependencies[qualifier] = dependency
    }

    replaceRequire(match, $1, $2) {
        const [importPath, importAs] = $2 ? [$2, $1] : [$1, null]

        const dependency = this.require(importPath)

        const qualifier = dependency.qualifier(importAs)
        const requireStatement = dependency.requireStatement(importAs)

        this.header += dependency.importStatement(importAs) + '\n'
        this.dependencies[qualifier] = dependency

        if (importAs) {
            return `var ${importAs} = ${requireStatement};`
        } else {
            return requireStatement
        }
    }
}

JSFile.registerFileType(/\.js$/)
