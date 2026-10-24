param location string
param tags object
param token string
param foundryProjectEndpoint string
param foundryModel string
param replaySpeed string

var eventHubName = 'match-events'
// Built-in role definition ids
var acrPullRole = '7f951dda-4ed3-4680-a7ca-43fe172d538d'
var eventHubsDataOwnerRole = 'f526a384-b230-433a-b45c-95f59c4a2dec'
var cosmosDataContributorRole = '00000000-0000-0000-0000-000000000002'

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-matchcopilot-${token}'
  location: location
  tags: tags
}

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-matchcopilot-${token}'
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: 'crmatchcopilot${token}'
  location: location
  tags: tags
  sku: { name: 'Basic' }
  properties: { adminUserEnabled: false }
}

resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, identity.id, acrPullRole)
  scope: registry
  properties: {
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRole)
  }
}

// ---------------------------------------------------------------- Event Hubs
resource ehNamespace 'Microsoft.EventHub/namespaces@2024-01-01' = {
  name: 'evh-matchcopilot-${token}'
  location: location
  tags: tags
  sku: { name: 'Basic', tier: 'Basic', capacity: 1 }
  properties: { disableLocalAuth: true }
}

resource eventHub 'Microsoft.EventHub/namespaces/eventhubs@2024-01-01' = {
  parent: ehNamespace
  name: eventHubName
  properties: {
    partitionCount: 2
    messageRetentionInDays: 1
  }
}

resource ehRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(ehNamespace.id, identity.id, eventHubsDataOwnerRole)
  scope: ehNamespace
  properties: {
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', eventHubsDataOwnerRole)
  }
}

// ---------------------------------------------------------------- Cosmos DB
resource cosmos 'Microsoft.DocumentDB/databaseAccounts@2024-11-15' = {
  name: 'cosmos-matchcopilot-${token}'
  location: location
  tags: tags
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    disableLocalAuth: true
    capabilities: [ { name: 'EnableServerless' } ]
    locations: [ { locationName: location, failoverPriority: 0 } ]
    consistencyPolicy: { defaultConsistencyLevel: 'Session' }
  }
}

resource cosmosDb 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-11-15' = {
  parent: cosmos
  name: 'matchcopilot'
  properties: { resource: { id: 'matchcopilot' } }
}

resource cards 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-11-15' = {
  parent: cosmosDb
  name: 'cards'
  properties: {
    resource: {
      id: 'cards'
      partitionKey: { paths: [ '/match_id' ], kind: 'Hash' }
    }
  }
}

resource cosmosRole 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-11-15' = {
  parent: cosmos
  name: guid(cosmos.id, identity.id, cosmosDataContributorRole)
  properties: {
    principalId: identity.properties.principalId
    roleDefinitionId: '${cosmos.id}/sqlRoleDefinitions/${cosmosDataContributorRole}'
    scope: cosmos.id
  }
}

// ---------------------------------------------------------------- Container Apps
resource env 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: 'cae-matchcopilot-${token}'
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
  }
}

resource web 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'ca-matchcopilot-${token}'
  location: location
  tags: union(tags, { 'azd-service-name': 'web' })
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${identity.id}': {} }
  }
  properties: {
    managedEnvironmentId: env.id
    configuration: {
      ingress: {
        external: true
        targetPort: 80
        transport: 'auto'
      }
      registries: [ { server: registry.properties.loginServer, identity: identity.id } ]
    }
    template: {
      containers: [
        {
          name: 'web'
          image: 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
          resources: { cpu: json('1.0'), memory: '2Gi' }
          env: [
            { name: 'AZURE_CLIENT_ID', value: identity.properties.clientId }
            { name: 'FOUNDRY_PROJECT_ENDPOINT', value: foundryProjectEndpoint }
            { name: 'FOUNDRY_MODEL', value: foundryModel }
            { name: 'EVENTHUB_NAMESPACE', value: '${ehNamespace.name}.servicebus.windows.net' }
            { name: 'EVENTHUB_NAME', value: eventHubName }
            { name: 'COSMOS_ENDPOINT', value: cosmos.properties.documentEndpoint }
            { name: 'REPLAY_SPEED', value: replaySpeed }
          ]
        }
      ]
      // One replica: live broadcasts are held in memory and shared by every viewer.
      scale: { minReplicas: 1, maxReplicas: 1 }
    }
  }
  dependsOn: [ acrPull ]
}

output registryLoginServer string = registry.properties.loginServer
output registryName string = registry.name
output webUri string = 'https://${web.properties.configuration.ingress.fqdn}'
output identityPrincipalId string = identity.properties.principalId
output cosmosEndpoint string = cosmos.properties.documentEndpoint
output eventHubNamespace string = '${ehNamespace.name}.servicebus.windows.net'
