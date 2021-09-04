const { expect } = require('chai');

// approximately 6000 blocks per day
const RATE = ethers.utils
  .parseUnits('1000', 18)
  .div(ethers.BigNumber.from('6000'));

const EXPIRATION = ethers.BigNumber.from('180000');

describe('ERC721Farm', function () {
  let signer;

  let erc721;
  let magic;
  let instance;

  let tokenId;

  const mineBlocks = async function (number) {
    for (let i = 0; i < number; i++) {
      await ethers.provider.send('evm_mine', []);
    }
  };

  before(async function () {
    [signer] = await ethers.getSigners();
  });

  beforeEach(async function () {
    const erc721Factory = await ethers.getContractFactory('Treasure');
    erc721 = await erc721Factory.deploy();
    await erc721.deployed();

    const magicFactory = await ethers.getContractFactory('Magic');
    magic = await magicFactory.deploy();
    await magic.deployed();

    const factory = await ethers.getContractFactory('ERC721Farm');
    instance = await factory.deploy(
      magic.address,
      erc721.address,
      RATE,
      EXPIRATION,
    );
    await instance.deployed();

    await magic.connect(signer).setWhitelist([instance.address]);

    tokenId = ethers.constants.One;

    await erc721.connect(signer).claim(tokenId);
    await erc721.connect(signer).setApprovalForAll(instance.address, true);
  });

  describe('#depositsOf', function () {
    it('returns list of deposited token ids for given user', async function () {
      expect(
        await instance.callStatic.depositsOf(signer.address),
      ).to.deep.have.members([]);

      await instance.connect(signer).deposit([tokenId]);

      expect(
        await instance.callStatic.depositsOf(signer.address),
      ).to.deep.have.members([tokenId]);

      await instance.connect(signer).withdraw([tokenId]);

      expect(
        await instance.callStatic.depositsOf(signer.address),
      ).to.deep.have.members([]);
    });
  });

  describe('#calculateTotalReward', function () {
    it('returns total pending rewards for given user and tokens');
  });

  describe('#calculateReward', function () {
    it('returns pending rewards for given user and token', async function () {
      expect(
        await instance.callStatic.calculateReward(signer.address, [tokenId]),
      ).to.deep.have.members([ethers.constants.Zero]);

      await instance.connect(signer).deposit([tokenId]);

      await mineBlocks(7);

      expect(
        await instance.callStatic.calculateReward(signer.address, [tokenId]),
      ).to.deep.have.members([RATE.mul(ethers.BigNumber.from('7'))]);
    });
  });

  describe('#claimRewards', function () {
    it('transfers pending rewards to sender', async function () {
      await instance.connect(signer).deposit([tokenId]);

      await mineBlocks(7);

      const expected = (
        await instance.callStatic.calculateTotalReward(signer.address, [
          tokenId,
        ])
      ).add(RATE);

      await expect(() =>
        instance.connect(signer).claimRewards([tokenId]),
      ).to.changeTokenBalance(magic, signer, expected);
    });

    it('resets pending rewards to zero', async function () {
      await instance.connect(signer).deposit([tokenId]);

      await mineBlocks(1);

      expect(
        await instance.callStatic.calculateTotalReward(signer.address, [
          tokenId,
        ]),
      ).not.to.equal(ethers.constants.Zero);
      await instance.connect(signer).claimRewards([tokenId]);
      expect(
        await instance.callStatic.calculateTotalReward(signer.address, [
          tokenId,
        ]),
      ).to.equal(ethers.constants.Zero);
    });
  });

  describe('#deposit', function () {
    it('transfers tokens from sender to contract', async function () {
      await expect(() =>
        instance.connect(signer).deposit([tokenId]),
      ).to.changeTokenBalances(
        erc721,
        [signer, instance],
        [ethers.constants.NegativeOne, ethers.constants.One],
      );
    });

    describe('reverts if', function () {
      it('deposit amount exceeds balance', async function () {
        await erc721
          .connect(signer)
          ['safeTransferFrom(address,address,uint256)'](
            signer.address,
            instance.address,
            tokenId,
          );

        await expect(
          instance.connect(signer).deposit([tokenId]),
        ).to.be.revertedWith('ERC721: transfer of token that is not own');
      });

      it('contract is not approved for transfer', async function () {
        await erc721.connect(signer).setApprovalForAll(instance.address, false);

        await expect(
          instance.connect(signer).deposit([tokenId]),
        ).to.be.revertedWith(
          'ERC721: transfer caller is not owner nor approved',
        );
      });
    });
  });

  describe('#withdraw', function () {
    it('transfers token from contract to sender', async function () {
      await instance.connect(signer).deposit([tokenId]);

      await expect(() =>
        instance.connect(signer).withdraw([tokenId]),
      ).to.changeTokenBalances(
        erc721,
        [signer, instance],
        [ethers.constants.One, ethers.constants.NegativeOne],
      );
    });

    it('transfers pending rewards to sender', async function () {
      await instance.connect(signer).deposit([tokenId]);

      await mineBlocks(7);

      const expected = (
        await instance.callStatic.calculateTotalReward(signer.address, [
          tokenId,
        ])
      ).add(RATE);

      await expect(() =>
        instance.connect(signer).withdraw([tokenId]),
      ).to.changeTokenBalance(magic, signer, expected);
    });

    describe('reverts if', function () {
      it('token has not been deposited by sender', async function () {
        await expect(
          instance.connect(signer).withdraw([tokenId]),
        ).to.be.revertedWith('ERC721Farm: token not deposited');

        await instance.connect(signer).deposit([tokenId]);

        await expect(
          instance.connect(signer).withdraw([ethers.constants.Two]),
        ).to.be.revertedWith('ERC721Farm: token not deposited');
      });
    });
  });
});
