import { composeAsync, prepareE2ECluster } from "./helpers/compose-environment";

export default async function setup() {
  await prepareE2ECluster();

  return async () => {
    await composeAsync(["down", "-v", "--remove-orphans"]);
  };
}
