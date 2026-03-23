import fs from 'fs'
import path from 'path'

export interface TagRuleDefinition {
  pattern: string
  match_type: string
  category_name?: string
}

export interface SubSegmentTagDefinition {
  tag_name: string
  color: string
  icon?: string
  rules: TagRuleDefinition[]
}

export type ActionCardBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered?: boolean; items: string[] }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'note'; text: string }

export interface ActionCardDefinition {
  id: string
  title: string
  icon: string
  icon_color: string
  blocks: ActionCardBlock[]
}

interface SpendWiseConfigFile {
  viewModeRules?: {
    homeInclude?: string[]
    weddingInclude?: string[]
  }
  internalTransfer?: {
    exactMerchants?: string[]
  }
  subSegmentTags?: SubSegmentTagDefinition[]
  actionCards?: ActionCardDefinition[]
}

export interface SpendWiseConfig {
  viewModeRules: {
    homeInclude: string[]
    weddingInclude: string[]
  }
  internalTransfer: {
    exactMerchants: string[]
  }
  subSegmentTags: SubSegmentTagDefinition[]
  actionCards: ActionCardDefinition[]
}

const DEFAULT_CONFIG_PATH = path.resolve(
  process.cwd(),
  'config/spendwise.defaults.json',
)
const PRIVATE_CONFIG_PATH = process.env.SPENDWISE_PRIVATE_CONFIG_PATH
  ? path.resolve(process.cwd(), process.env.SPENDWISE_PRIVATE_CONFIG_PATH)
  : path.resolve(process.cwd(), 'private/spendwise.private.json')

function readConfigFile(
  filePath: string,
  required: boolean,
): SpendWiseConfigFile {
  if (!fs.existsSync(filePath)) {
    if (required) {
      throw new Error(`SpendWise config file not found at ${filePath}`)
    }
    return {}
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as SpendWiseConfigFile
  } catch (error) {
    throw new Error(
      `Failed to parse SpendWise config at ${filePath}: ${String(error)}`,
    )
  }
}

function mergeStringArrays(...parts: Array<string[] | undefined>): string[] {
  return parts.flatMap((part) => part ?? [])
}

const defaultConfig = readConfigFile(DEFAULT_CONFIG_PATH, true)
const privateConfig = readConfigFile(PRIVATE_CONFIG_PATH, false)

export const privateConfigPath = fs.existsSync(PRIVATE_CONFIG_PATH)
  ? PRIVATE_CONFIG_PATH
  : null

export const spendWiseConfig: SpendWiseConfig = {
  viewModeRules: {
    homeInclude: mergeStringArrays(
      defaultConfig.viewModeRules?.homeInclude,
      privateConfig.viewModeRules?.homeInclude,
    ),
    weddingInclude: mergeStringArrays(
      defaultConfig.viewModeRules?.weddingInclude,
      privateConfig.viewModeRules?.weddingInclude,
    ),
  },
  internalTransfer: {
    exactMerchants: mergeStringArrays(
      defaultConfig.internalTransfer?.exactMerchants,
      privateConfig.internalTransfer?.exactMerchants,
    ),
  },
  subSegmentTags: [
    ...(defaultConfig.subSegmentTags ?? []),
    ...(privateConfig.subSegmentTags ?? []),
  ],
  actionCards:
    privateConfig.actionCards && privateConfig.actionCards.length > 0
      ? privateConfig.actionCards
      : (defaultConfig.actionCards ?? []),
}

export function expandSqlTemplates(
  templates: string[],
  tableAlias: string,
): string[] {
  return templates.map((template) => template.replaceAll('{alias}', tableAlias))
}
