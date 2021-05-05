# exit on error
set -e

PACKAGE_VERSION=$(node -p -e "require('./package.json').version")
git tag -f $PACKAGE_VERSION
git push --tags --force

./gen_changelog.sh
git commit -m "Update CHANGELOG.md" CHANGELOG.md && true
git push

[ -d ".vscode_test" ] && cp -r .vscode-test ..
git clean -fdx
npm install
git push
#npm run beforepublish
vsce publish
#npm run afterpublish
rm -f *.vsix
#vsce package
#COMMIT_LOG=$(git log -1 --format='%ci %H %s')
#PACKAGE_VERSION=$(node -p -e "require('./package.json').version")
#github-release upload \
#  --owner=spgennard \
#  --repo=vscode_cobol \
#  --tag="$PACKAGE_VERSION" \
#  --name=$PACKAGE_VERSION \
#  --body="${COMMIT_LOG}" \
#  cobol*.vsix
#
#npx ovsx publish cobol*.vsix -p $(cat $HOME/.ovsx.token)

mkdir .vscode-test 2>/dev/null && true
[ -d "../.vscode_test" ] && cp -r ../.vscode-test .

npm-check-updates

echo "use: ncu -u"
