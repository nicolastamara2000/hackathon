// Match Co-pilot on Azure: Container Apps + Event Hubs + Cosmos DB, models in Microsoft Foundry.
// Deploy with `azd up`. All service-to-service auth uses one user-assigned managed identity.
targetScope = 'subscription'

@minLength(1)
@maxLength(64)
@description('Name of the azd environment, used to name resources')
param environmentName string

@minLength(1)
@description('Azure region for all resources')
param location string

@description('Microsoft Foundry project endpoint, e.g. https://<resource>.services.ai.azure.com/api/projects/<project>')
param foundryProjectEndpoint string = ''

@description('Foundry model deployment name, e.g. gpt-5-mini')
param foundryModel string = ''

@description('Replay speed of the synthetic match (x real time)')
param replaySpeed string = '20'

var tags = { 'azd-env-name': environmentName }
var token = toLower(uniqueString(subscription().id, environmentName, location))

resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: 'rg-${environmentName}'
  location: location
  tags: tags
}

module app 'resources.bicep' = {
  name: 'resources'
  scope: rg
  params: {
    location: location
    tags: tags
    token: token
    foundryProjectEndpoint: foundryProjectEndpoint
    foundryModel: foundryModel
    replaySpeed: replaySpeed
  }
}

output AZURE_RESOURCE_GROUP string = rg.name
output AZURE_CONTAINER_REGISTRY_ENDPOINT string = app.outputs.registryLoginServer
output AZURE_CONTAINER_REGISTRY_NAME string = app.outputs.registryName
output SERVICE_WEB_URI string = app.outputs.webUri
output AZURE_MANAGED_IDENTITY_PRINCIPAL_ID string = app.outputs.identityPrincipalId
output COSMOS_ENDPOINT string = app.outputs.cosmosEndpoint
output EVENTHUB_NAMESPACE string = app.outputs.eventHubNamespace
