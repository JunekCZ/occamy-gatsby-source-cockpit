const { TYPE_PREFIX_COCKPIT } = require('./constants')
const hash = require('string-hash')
const { generateNodeId } = require('gatsby-node-helpers').default({
  typePrefix: TYPE_PREFIX_COCKPIT,
})

function getFieldsOfTypes(item, types) {
  const fieldsOfTypes = Object.keys(item)
    .filter((fieldName) => {
      if (!item[fieldName]) return false
      if (!Array.isArray(item[fieldName]))
        return types.includes(item[fieldName].type)
      return item[fieldName].some((field) => types.includes(field.type))
    })
    .map((fieldName) => item[fieldName])

  // process children
  if (item._children) {
    item._children.forEach((child) => {
      fieldsOfTypes.push(...getFieldsOfTypes(child, types))
    })
  }

  // process nested fields
  Object.keys(item).forEach((fieldName) => {
    if (Array.isArray(item[fieldName])) {
      item[fieldName].forEach((field) => {
        fieldsOfTypes.push(...getFieldsOfTypes(field, types))
      })
    }
  })

  return fieldsOfTypes
}

function linkImageFieldsToImageNodes(node, images) {
  getFieldsOfTypes(node, ['image']).forEach((field) => {
    if (!Array.isArray(field)) {
      if (images[field.path] !== null) {
        field.value___NODE = images[field.path].id
        delete field.path
      } else {
        field.path = null
      }
    } else {
      field.forEach((imageField) => {
        if (
          images[imageField.path] !== undefined &&
          images[imageField.path] !== null
        ) {
          imageField.value___NODE = images[imageField.path].id
          delete imageField.path
        } else {
          imageField.path = null
        }
      })
    }
  })

  getFieldsOfTypes(node, ['gallery']).forEach((field) => {
    if (Array.isArray(field.value)) {
      field.value___NODE = field.value
        .map((imageField) =>
          images[imageField.value] !== null ? images[imageField.value].id : null
        )
        .filter((imageId) => imageId != null)
    }
    delete field.value
  })
}

function linkAssetFieldsToAssetNodes(node, assets) {
  getFieldsOfTypes(node, ['asset']).forEach((field) => {
    if (assets[field.value]) {
      field.value___NODE = assets[field.value].id
      delete field.value
    } else {
      field.value = null
    }
  })
}

function createObjectNodes(node, objectNodeFactory) {
  getFieldsOfTypes(node, ['object']).forEach((field) => {
    const objectNodeId = objectNodeFactory.create(field.value)
    field.value___NODE = objectNodeId
    delete field.value
  })
}

function linkMarkdownFieldsToMarkdownNodes(node, markdowns) {
  getFieldsOfTypes(node, ['markdown']).forEach((field) => {
    field.value___NODE = markdowns[field.value].id
    delete field.value
  })
}

function linkLayoutFieldsToLayoutNodes(node, layouts) {
  getFieldsOfTypes(node, ['layout', 'layout-grid']).forEach((field) => {
    const layoutHash = hash(JSON.stringify(field.value))
    field.value___NODE = layouts[layoutHash].id
    delete field.value
  })
}

function linkCollectionLinkFieldsToCollectionItemNodes(node) {
  getFieldsOfTypes(node, ['collectionlink']).forEach((field) => {
    if (Array.isArray(field.value)) {
      const collectionName = field.value[0].link

      field.value.forEach((linkedCollection) => {
        if (linkedCollection.link !== collectionName) {
          throw new Error(
            `One to many Collection-Links must refer to entries from a single collection (concerned field: ${fieldName})`
          )
        }
      })

      field.value___NODE = field.value.map((linkedCollection) =>
        generateNodeId(
          linkedCollection.link,
          node.lang === 'any'
            ? linkedCollection._id
            : `${linkedCollection._id}_${node.lang}`
        )
      )
    } else {
      field.value___NODE = generateNodeId(
        field.value.link,
        node.lang === 'any'
          ? field.value._id
          : `${field.value._id}_${node.lang}`
      )
    }

    delete field.value
  })
}

module.exports = {
  getFieldsOfTypes,
  linkImageFieldsToImageNodes,
  linkAssetFieldsToAssetNodes,
  linkMarkdownFieldsToMarkdownNodes,
  linkLayoutFieldsToLayoutNodes,
  linkCollectionLinkFieldsToCollectionItemNodes,
  createObjectNodes,
}
