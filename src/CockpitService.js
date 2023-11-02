const mime = require('mime')
const request = require('request-promise')
const slugify = require('slugify')
const hash = require('string-hash')

const {
  METHODS,
  MARKDOWN_IMAGE_REGEXP,
  MARKDOWN_ASSET_REGEXP,
} = require('./constants')
const { default: axios } = require('axios')
const getFieldsOfTypes = require('./helpers.js').getFieldsOfTypes
var nodes = []

module.exports = class CockpitService {
  constructor(
    baseUrl,
    token,
    locales,
    collections,
    trees,
    whiteListedCollectionNames = [],
    whiteListedSingletonNames = [],
    aliases = {}
  ) {
    this.baseUrl = baseUrl
    this.token = token
    this.locales = locales
    this.collections = collections
    this.trees = trees
    this.whiteListedCollectionNames = whiteListedCollectionNames
    this.whiteListedSingletonNames = whiteListedSingletonNames
    this.aliases = aliases
  }

  async fetch(endpoint, method, lang = null) {
    let req = axios({
      url: `${this.baseUrl}/api${endpoint}${lang ? `?lang=${lang}` : ''}`,
      headers: {
        'api-key': `${this.token}`,
      },
      method: method,
    })
      .then((res) => {
        return res.data
      })
      .catch((err) => {
        console.log('Error while fetching', endpoint)
        console.error(err)
      })
    return req
  }

  async validateBaseUrl() {
    try {
      await this.fetch('/system/healthcheck', METHODS.GET)
    } catch (error) {
      throw new Error(
        'BaseUrl config parameter is invalid or there is no internet connection'
      )
    }
  }

  async validateToken() {
    try {
      await this.fetch('/system/healthcheck', METHODS.GET)
    } catch (error) {
      throw new Error('Token config parameter is invalid')
    }
  }

  async getCollection(name) {
    const collection = await this.fetch(`/content/items/${name}`, METHODS.GET)
    const collectionItems = collection.map((collectionEntry) => {
      const collectionFields = Object.entries(collectionEntry)
      return createCollectionItem(name, collectionFields, collectionEntry)
    })

    /*for (let index = 0; index < this.locales.length; index++) {
      const {
        fields: collectionFields,
        entries: collectionEntries,
      } = await this.fetch(
        `/content/items/${name}`,
        METHODS.GET,
        this.locales[index]
      )

      collectionItems.push(
        ...collectionEntries.map(collectionEntry =>
          createCollectionItem(
            name,
            collectionFields,
            collectionEntry,
          )
        )
      )
    }*/

    const officialName =
      (this.aliases['collection'] && this.aliases['collection'][name]) || name

    return { items: collectionItems, name: officialName }
  }

  async getTree(name) {
    const tree = await this.fetch(`/content/tree/${name}`, METHODS.GET)

    const treeItems = tree.map((treeEntry) => {
      const treeFields = Object.entries(treeEntry)
      return createTreeItem(name, treeFields, treeEntry)
    })

    /*const treeItems = [createSingletonItem(treeDescriptor, treeEntry)]

    for (let index = 0; index < this.locales.length; index++) {
      const treeEntry = await this.fetch(
        `/content/tree/${name}`,
        METHODS.GET,
        this.locales[index]
      )

      treeItems.push(
        createSingletonItem(treeDescriptor, treeEntry, this.locales[index])
      )
    }*/

    return { items: treeItems, name: name }
  }

  async getCollections() {
    const names = this.collections
    if (!names || names.length === 0) return

    return Promise.all(names.map((name) => this.getCollection(name)))
  }

  async getTrees() {
    const names = this.trees
    if (!names || names.length === 0) return

    return Promise.all(names.map((name) => this.getTree(name)))
  }

  normalizeResources(nodes) {
    const existingImages = {}
    const existingAssets = {}
    const existingMarkdowns = {}
    const existingLayouts = {}

    nodes.forEach((node) => {
      node.items.forEach((item) => {
        this.normalizeNodeItemImages(item, existingImages)
        this.normalizeNodeItemAssets(item, existingAssets)
        this.normalizeNodeItemMarkdowns(
          item,
          existingImages,
          existingAssets,
          existingMarkdowns
        )
        this.normalizeNodeItemLayouts(
          item,
          existingImages,
          existingAssets,
          existingMarkdowns,
          existingLayouts
        )
      })
    })

    return {
      images: existingImages,
      assets: existingAssets,
      markdowns: existingMarkdowns,
      layouts: existingLayouts,
    }
  }

  normalizeNodeItemImages(item, existingImages) {
    getFieldsOfTypes(item, ['image', 'gallery']).forEach((field) => {
      if (!Array.isArray(field.value)) {
        const imageField = field
        let path = imageField.value.path

        if (path == null) {
          return
        }

        if (path.startsWith('/')) {
          path = `${this.baseUrl}${path}`
        } else if (!path.startsWith('http')) {
          path = `${this.baseUrl}/${path}`
        }

        imageField.value = path
        existingImages[path] = null
      } else {
        const galleryField = field

        galleryField.value.forEach((galleryImageField) => {
          let path = galleryImageField.path

          if (path == null) {
            return
          }

          trimGalleryImageField(galleryImageField)

          if (path.startsWith('/')) {
            path = `${this.baseUrl}${path}`
          } else if (!path.startsWith('http')) {
            path = `${this.baseUrl}/${path}`
          }

          galleryImageField.value = path
          existingImages[path] = null
        })
      }
    })

    if (Array.isArray(item.children)) {
      item.children.forEach((child) => {
        this.normalizeNodeItemImages(child, existingImages)
      })
    }
  }

  normalizeNodeItemAssets(item, existingAssets) {
    getFieldsOfTypes(item, ['asset']).forEach((assetField) => {
      let path = assetField.value.path

      trimAssetField(assetField)

      path = `${this.baseUrl}/storage/uploads${path}`

      assetField.value = path
      existingAssets[path] = null
    })

    if (Array.isArray(item.children)) {
      item.children.forEach((child) => {
        this.normalizeNodeItemAssets(child, existingAssets)
      })
    }
  }

  normalizeNodeItemMarkdowns(
    item,
    existingImages,
    existingAssets,
    existingMarkdowns
  ) {
    getFieldsOfTypes(item, ['markdown']).forEach((markdownField) => {
      existingMarkdowns[markdownField.value] = null
      extractImagesFromMarkdown(markdownField.value, existingImages)
      extractAssetsFromMarkdown(markdownField.value, existingAssets)
    })

    if (Array.isArray(item.children)) {
      item.children.forEach((child) => {
        this.normalizeNodeItemMarkdowns(
          child,
          existingImages,
          existingAssets,
          existingMarkdowns
        )
      })
    }
  }

  normalizeNodeItemLayouts(
    item,
    existingImages,
    existingAssets,
    existingMarkdowns,
    existingLayouts
  ) {
    getFieldsOfTypes(item, ['layout', 'layout-grid']).forEach((layoutField) => {
      const stringifiedLayout = JSON.stringify(layoutField.value)
      const layoutHash = hash(stringifiedLayout)
      existingLayouts[layoutHash] = layoutField.value
      // TODO: this still needs to be implemented for layout fields
      // extractImagesFromMarkdown(markdownField.value, existingImages)
      // extractAssetsFromMarkdown(markdownField.value, existingAssets)
    })

    if (Array.isArray(item.children)) {
      item.children.forEach((child) => {
        this.normalizeNodeItemLayouts(
          child,
          existingImages,
          existingAssets,
          existingMarkdowns,
          existingLayouts
        )
      })
    }
  }
}

const trimAssetField = (assetField) => {
  delete assetField.value._id
  delete assetField.value.path
  delete assetField.value.title
  delete assetField.value.mime
  delete assetField.value.size
  delete assetField.value.image
  delete assetField.value.video
  delete assetField.value.audio
  delete assetField.value.archive
  delete assetField.value.document
  delete assetField.value.code
  delete assetField.value.created
  delete assetField.value.modified
  delete assetField.value._by

  Object.keys(assetField.value).forEach((attribute) => {
    assetField[attribute] = assetField.value[attribute]
    delete assetField.value[attribute]
  })
}

const trimGalleryImageField = (galleryImageField) => {
  galleryImageField.type = 'image'

  delete galleryImageField.meta.asset
  delete galleryImageField.path
}

const createCollectionItem = (
  collectionName,
  collectionFields,
  collectionEntry,
  level = 1
) => {
  const item = {
    cockpitId: collectionEntry._id,
    cockpitCreated: new Date(collectionEntry._created * 1000),
    cockpitModified: new Date(collectionEntry._modified * 1000),
    // TODO: Replace with Users... once implemented (GitHub Issue #15)
    cockpitBy: collectionEntry._by,
    cockpitCreatedBy: collectionEntry._cby,
    cockpitModifiedBy: collectionEntry._mby,
    parentId: collectionEntry._pid,
    level: level,
  }

  collectionFields.reduce((accumulator, collectionFieldName) => {
    const fieldName = collectionFieldName[0]
    const collectionFieldValue = collectionEntry[fieldName]
    const field = createNodeField(
      'collection',
      collectionName,
      collectionFieldValue,
      fieldName
    )

    if (field !== null) {
      accumulator[fieldName] = field
    }

    return accumulator
  }, item)

  /*if (collectionEntry.hasOwnProperty('children')) {
    item.children = collectionEntry.children.map((childEntry) => {
      return createCollectionItem(
        collectionName,
        collectionFields,
        childEntry,
        level + 1
      )
    })
  }*/

  return item
}

const createTreeItem = (treeName, treeFields, treeEntry) => {
  const item = {
    cockpitId: treeEntry._id,
    cockpitCreated: new Date(treeEntry._created * 1000),
    cockpitModified: new Date(treeEntry._modified * 1000),
    // TODO: Replace with Users... once implemented (GitHub Issue #15)
    cockpitBy: treeEntry._by,
    cockpitCreatedBy: treeEntry._cby,
    cockpitModifiedBy: treeEntry._mby,
    parentId: treeEntry._pid,
  }

  treeFields.reduce((accumulator, treeFieldName) => {
    const fieldName = treeFieldName[0]
    let treeFieldValue = treeEntry[fieldName]
    let field
    if (
      treeFieldValue &&
      fieldName === '_children' &&
      treeFieldValue.length > 0
    ) {
      let childArray = []
      treeFieldValue.forEach((child) => {
        const treeFieldsChild = Object.entries(child)
        childArray.push(createTreeItem(treeName, treeFieldsChild, child))
      })
      field = childArray
    } else {
      field = createNodeField('tree', treeName, treeFieldValue, fieldName)
    }

    if (field !== null) {
      accumulator[fieldName] = field
    }

    return accumulator
  }, item)

  return item
}

const createNodeField = (nodeType, nodeName, nodeFieldValue, nodeFieldSlug) => {
  if (
    !(Array.isArray(nodeFieldValue) && nodeFieldValue.length === 0) &&
    nodeFieldValue != null &&
    nodeFieldValue !== ''
  ) {
    if (!(nodeFieldValue instanceof Object)) {
      return nodeFieldValue
    }

    const itemField = {
      value: nodeFieldValue,
    }

    return itemField
  }

  return null
}

const extractImagesFromMarkdown = (markdown, existingImages) => {
  let unparsedMarkdown = markdown
  let match

  while ((match = MARKDOWN_IMAGE_REGEXP.exec(unparsedMarkdown))) {
    unparsedMarkdown = unparsedMarkdown.substring(match.index + match[0].length)
    existingImages[match[1]] = null
  }
}

const extractAssetsFromMarkdown = (markdown, existingAssets) => {
  let unparsedMarkdown = markdown
  let match

  while ((match = MARKDOWN_ASSET_REGEXP.exec(unparsedMarkdown))) {
    unparsedMarkdown = unparsedMarkdown.substring(match.index + match[0].length)
    const mediaType = mime.getType(match[1])

    if (mediaType && mediaType !== 'text/html') {
      existingAssets[match[1]] = null
    }
  }
}
