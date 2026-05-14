import { nodeRegistry } from './registry'
import { textDescriptor } from './text'
import { palaceDescriptor } from './palace'

nodeRegistry.register(textDescriptor)
nodeRegistry.register(palaceDescriptor)

export { nodeRegistry } from './registry'
export { NodeTypeDescriptor } from './types'
