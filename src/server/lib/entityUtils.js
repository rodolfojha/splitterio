const util = require("./util");

function getPosition(isUniform, radius, uniformPositions, redZone = null) {
    if (redZone && redZone.radius) {
        // Use safe positioning when red zone is available
        return isUniform ? util.uniformSafePosition(uniformPositions, radius, redZone) : util.randomSafePosition(radius, redZone);
    } else {
        // Fallback to original positioning when no red zone
        return isUniform ? util.uniformPosition(uniformPositions, radius) : util.randomPosition(radius);
    }
}

function isVisibleEntity(entity, player, addThreshold = true) {
    const entityHalfSize = entity.radius + (addThreshold ? entity.radius * 0.1 : 0);
    return util.testRectangleRectangle(
        entity.x, entity.y, entityHalfSize, entityHalfSize,
        player.x, player.y, player.screenWidth / 2, player.screenHeight / 2);
}

module.exports = {
    getPosition,
    isVisibleEntity
}
